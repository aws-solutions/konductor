// SPDX-License-Identifier: Apache-2.0
//! Conformance checks for the way the runner uses `claude -p`: the arguments of [`workflow_adapters::claude_args`] and
//! the rules of [`workflow_adapters::tool_rules`], run against the real program.
//!
//! The suite is opt-in. A plain `cargo test` skips every check with a message, because each one starts a real session
//! and spends model time. To run it:
//!
//! ```text
//! KONDUCTOR_CLAUDE_CONFORMANCE=1 cargo test --test claude_conformance -- --nocapture --test-threads=1
//! ```
//!
//! `KONDUCTOR_CLAUDE_PROGRAM` names another program than `claude`. A check is skipped, with a message, when the program
//! is not installed or a first session fails, which is what a missing login looks like.
//!
//! **Isolation.** Each check works in its own temporary project with a git folder, its own `.claude/agents` and its own
//! `.claude/settings.json`, and runs with `--setting-sources project,local`. `CLAUDE_CONFIG_DIR` is a temporary folder
//! too, so the user's own settings, rules and agents are never read or changed, and no credential is copied. Login comes
//! from the environment of the test process, as for any other session. Each agent uses the model `claude-sonnet-5-5`.
//!
//! Each check prints one line, `CONFORMANCE <check> <PASS|FAIL> <evidence>`, so the results can go into a table.

#![cfg(unix)]

mod common;

use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use common::TempDir;
use workflow_adapters::{claude_args, tool_rules, ToolRules};
use workflow_core::json::{self, Json};
use workflow_core::ports::{AgentCatalog, Runner};

const SWITCH: &str = "KONDUCTOR_CLAUDE_CONFORMANCE";
const PROGRAM_ENV: &str = "KONDUCTOR_CLAUDE_PROGRAM";
const MODEL: &str = "claude-sonnet-5-5";
/// A session that runs longer than this is killed and the check fails.
const SESSION_LIMIT: Duration = Duration::from_secs(240);

/// One session at a time: the checks share the model service, and the output reads better.
fn one_at_a_time() -> std::sync::MutexGuard<'static, ()> {
    static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());
    SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn program() -> String {
    std::env::var(PROGRAM_ENV)
        .ok()
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "claude".to_string())
}

/// What a session printed, read the way the harness reads it.
struct Reply {
    exit: Option<i32>,
    json: Option<Json>,
    stdout: String,
}

impl Reply {
    fn result(&self) -> String {
        self.json
            .as_ref()
            .and_then(|j| j.get("result"))
            .and_then(Json::as_str)
            .unwrap_or_default()
            .to_string()
    }

    fn is_error(&self) -> bool {
        self.json.as_ref().and_then(|j| j.get("is_error")) == Some(&Json::Bool(true))
    }

    /// The names of the tools whose call the session denied.
    fn denied(&self) -> Vec<String> {
        self.json
            .as_ref()
            .and_then(|j| j.get("permission_denials"))
            .and_then(Json::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|i| i.get("tool_name").and_then(Json::as_str))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The models that the session used, from `modelUsage`.
    fn models(&self) -> Vec<String> {
        match self.json.as_ref().and_then(|j| j.get("modelUsage")) {
            Some(Json::Object(map)) => map.keys().cloned().collect(),
            _ => Vec::new(),
        }
    }
}

/// A temporary project and a temporary Claude config folder.
struct Lab {
    project: TempDir,
    config: TempDir,
}

impl Lab {
    fn new(label: &str) -> Lab {
        let lab = Lab {
            project: TempDir::new(&format!("conf-{label}")),
            config: TempDir::new(&format!("conf-{label}-config")),
        };
        // A git folder keeps any search for a project root inside the temporary project.
        let status = Command::new("git")
            .args(["init", "-q"])
            .arg(lab.project.path())
            .stdin(Stdio::null())
            .status();
        assert!(status.is_ok_and(|s| s.success()), "git init failed");
        lab.settings("{}");
        lab
    }

    /// An agent file. `front` is extra front matter lines such as `tools: Read`.
    fn agent(&self, id: &str, front: &str, body: &str) {
        self.project.write(
            &format!(".claude/agents/{id}.md"),
            format!("---\nname: {id}\ndescription: conformance agent\nmodel: {MODEL}\n{front}\n---\n{body}\n")
                .as_bytes(),
        );
    }

    fn settings(&self, text: &str) {
        self.project.write(".claude/settings.json", text.as_bytes());
    }

    fn file(&self, name: &str) -> PathBuf {
        self.project.path().join(name)
    }

    /// The `--allowedTools` rules the runner would pass for the agent's own file.
    fn rules(&self, agent: &str) -> Vec<String> {
        let catalog = workflow_adapters::FileAgentCatalog::new(self.project.path(), None);
        let definition = catalog
            .definitions(agent)
            .into_iter()
            .find(|d| d.runner == Runner::Claude)
            .expect("the agent file");
        match tool_rules(&definition.tools) {
            ToolRules::Rules(rules) => rules,
            ToolRules::None | ToolRules::Unknown(_) => Vec::new(),
        }
    }

    /// Runs the runner's arguments for `agent`, with `rules` as `--allowedTools`, and `--setting-sources` so that only
    /// the project's settings count.
    fn run_with(&self, agent: &str, prompt: &str, rules: &[String]) -> Reply {
        let mut args = claude_args(agent, rules, prompt);
        // Before `--allowedTools`, which takes every argument after it.
        args.splice(
            2..2,
            ["--setting-sources".to_string(), "project,local".to_string()],
        );
        self.run_raw(&args)
    }

    /// Runs the runner's arguments with the rules of the agent's own `tools`, as the runner does.
    fn run(&self, agent: &str, prompt: &str) -> Reply {
        let rules = self.rules(agent);
        self.run_with(agent, prompt, &rules)
    }

    fn run_raw(&self, args: &[String]) -> Reply {
        let mut child = Command::new(program())
            .args(args)
            .current_dir(self.project.path())
            .env("CLAUDE_CONFIG_DIR", self.config.path())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("start the program");
        let mut stdout = child.stdout.take().expect("stdout");
        let reader = std::thread::spawn(move || {
            let mut text = String::new();
            let _ = std::io::Read::read_to_string(&mut stdout, &mut text);
            text
        });
        let until = Instant::now() + SESSION_LIMIT;
        let status = loop {
            match child.try_wait().expect("wait") {
                Some(status) => break Some(status),
                None if Instant::now() >= until => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                None => std::thread::sleep(Duration::from_millis(50)),
            }
        };
        let stdout = reader.join().unwrap_or_default();
        Reply {
            exit: status.and_then(|s| s.code()),
            json: json::parse(&stdout).ok(),
            stdout,
        }
    }
}

/// Why the checks cannot run, or `None` when they can. Worked out once: the program is asked for its version, and a
/// first session shows whether it can reach a model.
fn unavailable() -> Option<String> {
    static ANSWER: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    ANSWER
        .get_or_init(|| {
            if std::env::var(SWITCH).as_deref() != Ok("1") {
                return Some(format!(
                    "set {SWITCH}=1 to run the Claude Code conformance checks"
                ));
            }
            let installed = Command::new(program())
                .arg("--version")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|s| s.success());
            if !installed {
                return Some(format!("`{}` is not installed or does not run", program()));
            }
            let lab = Lab::new("probe");
            lab.agent("conf-probe", "tools: Read", "Reply with one word.");
            let reply = lab.run("conf-probe", "Say hi.");
            if reply.exit == Some(0) && reply.json.is_some() && !reply.is_error() {
                return None;
            }
            let why = if reply.is_error() {
                reply.result()
            } else {
                reply.stdout.chars().take(200).collect()
            };
            Some(format!(
                "no session could run, so `{}` is probably not signed in: {why}",
                program()
            ))
        })
        .clone()
}

/// Whether `check` can run. Prints why not.
fn ready(check: &str) -> bool {
    match unavailable() {
        None => true,
        Some(why) => {
            eprintln!("CONFORMANCE {check} SKIP {why}");
            false
        }
    }
}

fn pass(check: &str, evidence: &str) {
    eprintln!("CONFORMANCE {check} PASS {evidence}");
}

/// Checks `ok`, and prints the failure line before it panics so the output shows which check failed and why.
fn verify(check: &str, ok: bool, evidence: String) {
    if ok {
        pass(check, &evidence);
    } else {
        eprintln!("CONFORMANCE {check} FAIL {evidence}");
        panic!("{check} failed: {evidence}");
    }
}

/// Runs a check that expects a file to be written, again once if the model did not try, since a model can answer in
/// words. A denial is not retried: that is the result.
fn run_expecting_file(lab: &Lab, agent: &str, prompt: &str, file: &str) -> Reply {
    let mut reply = lab.run(agent, prompt);
    if !lab.file(file).exists() && reply.denied().is_empty() {
        reply = lab.run(agent, prompt);
    }
    reply
}

#[test]
fn a_the_agent_flag_runs_the_named_agents_prompt_model_and_tools() {
    let check = "(a) --agent runs the agent's prompt, model and tools";
    let _serial = one_at_a_time();
    if !ready(check) {
        return;
    }
    let lab = Lab::new("a");
    lab.agent(
        "conf-a",
        "tools: Read",
        "Begin every reply with the exact token CONF-A-7731, then answer in one short sentence.",
    );
    lab.project.write("secret-a.txt", b"SECRET-A-4417");
    let reply = lab.run(
        "conf-a",
        "Read secret-a.txt in the current directory and tell me what it says.",
    );
    let result = reply.result();
    let models = reply.models();
    verify(
        check,
        result.contains("CONF-A-7731") && result.contains("SECRET-A-4417") && models == [MODEL],
        format!(
            "result={result:?} modelUsage={models:?} rules={:?}",
            lab.rules("conf-a")
        ),
    );
}

#[test]
fn b_a_listed_tool_runs_with_no_settings_rule_for_it() {
    let check = "(b) a tool in `tools` runs with no settings rule";
    let _serial = one_at_a_time();
    if !ready(check) {
        return;
    }
    let lab = Lab::new("b");
    lab.agent(
        "conf-w",
        "tools: Write",
        "Do exactly what the user asks, in one short sentence.",
    );
    // Control: the settings hold no rule and the session has no `--allowedTools`, so the write is denied.
    let prompt = "Create the file out-b.txt in the current directory containing exactly OK-B.";
    let control = lab.run_with("conf-w", prompt, &[]);
    let control_written = lab.file("out-b.txt").exists();
    let _ = fs::remove_file(lab.file("out-b.txt"));
    let reply = run_expecting_file(&lab, "conf-w", prompt, "out-b.txt");
    let written = fs::read_to_string(lab.file("out-b.txt")).ok();
    verify(
        check,
        written.as_deref() == Some("OK-B")
            && !control_written
            && control.denied() == ["Write"]
            && reply.denied().is_empty(),
        format!(
            "rules={:?} file={written:?} control_denied={:?} control_file_written={control_written}",
            lab.rules("conf-w"),
            control.denied()
        ),
    );
}

#[test]
fn c_a_tool_not_in_tools_is_not_available() {
    let check = "(c) a tool not in `tools` is not available";
    let _serial = one_at_a_time();
    if !ready(check) {
        return;
    }
    let lab = Lab::new("c");
    lab.agent(
        "conf-r",
        "tools: Read",
        "Do exactly what the user asks. If a tool you are asked to use is not available to you, reply exactly NO-SUCH-TOOL.",
    );
    let write = lab.run(
        "conf-r",
        "Use the Write tool to create out-c1.txt containing OK-C.",
    );
    let shell = lab.run("conf-r", "Use the Bash tool to run: echo OK > out-c2.txt");
    verify(
        check,
        !lab.file("out-c1.txt").exists()
            && !lab.file("out-c2.txt").exists()
            && write.denied().is_empty()
            && shell.denied().is_empty(),
        format!(
            "write_result={:?} bash_result={:?} files_written=false denials=none (the tools were not offered, not denied)",
            write.result(),
            shell.result()
        ),
    );
}

#[test]
fn d_with_no_tools_key_a_call_that_needs_approval_is_denied() {
    let check = "(d) no `tools` key: a call that needs approval is denied";
    let _serial = one_at_a_time();
    if !ready(check) {
        return;
    }
    let lab = Lab::new("d");
    lab.agent(
        "conf-n",
        "",
        "Do exactly what the user asks, in one short sentence.",
    );
    let rules = lab.rules("conf-n");
    let reply = lab.run(
        "conf-n",
        "Use the Write tool to create out-d.txt containing OK-D.",
    );
    verify(
        check,
        rules.is_empty() && !lab.file("out-d.txt").exists() && reply.denied() == ["Write"],
        format!(
            "rules={rules:?} file_written=false denied={:?}",
            reply.denied()
        ),
    );
}

#[test]
fn e_an_allow_rule_for_a_tool_outside_tools_does_not_make_it_available() {
    let check = "(e) a settings or flag allow rule outside `tools` adds nothing";
    let _serial = one_at_a_time();
    if !ready(check) {
        return;
    }
    let lab = Lab::new("e");
    lab.agent(
        "conf-r",
        "tools: Read",
        "Do exactly what the user asks. If a tool you are asked to use is not available to you, reply exactly NO-SUCH-TOOL.",
    );
    let prompt = "Use the Write tool to create out-e.txt containing OK-E.";
    lab.settings(r#"{"permissions":{"allow":["Write"]}}"#);
    let by_settings = lab.run("conf-r", prompt);
    let settings_wrote = lab.file("out-e.txt").exists();
    lab.settings("{}");
    let by_flag = lab.run_with("conf-r", prompt, &["Read".to_string(), "Write".to_string()]);
    let flag_wrote = lab.file("out-e.txt").exists();
    verify(
        check,
        !settings_wrote && !flag_wrote,
        format!(
            "settings_allow_write: file_written={settings_wrote} result={:?}; flag_rule_write: file_written={flag_wrote} result={:?}",
            by_settings.result(),
            by_flag.result()
        ),
    );
}

#[test]
fn f_a_settings_deny_rule_for_a_listed_tool_wins_over_allowed_tools() {
    let check = "(f) a settings deny rule wins over `--allowedTools`";
    let _serial = one_at_a_time();
    if !ready(check) {
        return;
    }
    let lab = Lab::new("f");
    lab.agent(
        "conf-w",
        "tools: Write",
        "Do exactly what the user asks, in one short sentence.",
    );
    let prompt = "Create the file out-f.txt in the current directory containing exactly OK-F.";
    // Control: the same session with no deny rule writes the file.
    let control = run_expecting_file(&lab, "conf-w", prompt, "out-f.txt");
    let control_wrote = lab.file("out-f.txt").exists();
    let _ = fs::remove_file(lab.file("out-f.txt"));
    lab.settings(r#"{"permissions":{"deny":["Write"]}}"#);
    let rules = lab.rules("conf-w");
    let reply = lab.run("conf-w", prompt);
    let wrote = lab.file("out-f.txt").exists();
    verify(
        check,
        control_wrote && !wrote,
        format!(
            "rules={rules:?} control_file_written={control_wrote} with_deny_file_written={wrote} result={:?} control_denied={:?}",
            reply.result().chars().take(80).collect::<String>(),
            control.denied()
        ),
    );
}

#[test]
fn g_the_prompt_is_not_consumed_as_an_allowed_tools_rule() {
    let check = "(g) the prompt is not read as an `--allowedTools` rule";
    let _serial = one_at_a_time();
    if !ready(check) {
        return;
    }
    let lab = Lab::new("g");
    lab.agent("conf-r", "tools: Read", "Do exactly what the user asks.");
    let prompt = "Reply with exactly the word PROMPT-G-SEEN.";
    let reply = lab.run("conf-r", prompt);
    // The same arguments with the prompt after the list, as the runner never writes them: the flag takes it.
    let wrong: Vec<String> = [
        "-p",
        "--output-format",
        "json",
        "--agent",
        "conf-r",
        "--setting-sources",
        "project,local",
        "--allowedTools",
        "Read",
        prompt,
    ]
    .iter()
    .map(|a| (*a).to_string())
    .collect();
    let reversed = lab.run_raw(&wrong);
    verify(
        check,
        reply.result().contains("PROMPT-G-SEEN")
            && reversed.exit != Some(0)
            && !reversed.result().contains("PROMPT-G-SEEN"),
        format!(
            "runner_order_result={:?} prompt_after_flag_exit={:?} prompt_after_flag_output={:?}",
            reply.result(),
            reversed.exit,
            reversed.stdout.chars().take(80).collect::<String>()
        ),
    );
}
