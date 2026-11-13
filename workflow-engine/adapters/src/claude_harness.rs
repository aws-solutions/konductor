// SPDX-License-Identifier: Apache-2.0
//! The `claude` harness: one headless Claude Code session for each agent stage (spec: "Harness invocation").
//!
//! The session is `claude -p "<prompt>" --output-format json --agent <id> [--allowedTools "<rule>,<rule>"]`, started in
//! the project root through the [`ProcessLauncher`] port. Its final message is the `result` field of the JSON reply on
//! standard output.
//!
//! **Argument order.** The prompt comes right after `-p`, and `--allowedTools` comes last, because the flag takes a
//! list and would read any argument after it as another rule.
//!
//! **Permissions (D19).** `--agent` makes the session run as the stage's agent, and the `tools` of that agent cap what
//! the session has. The runner passes one `--allowedTools` rule for each tool in that list ([`tool_rules`]), so the
//! tools the definition makes available run without asking, and nothing else does. It passes no permission mode and no
//! flag that skips permission checks. The user's settings can still deny a tool in the list.
//!
//! **The reply.** A reply that is not JSON, or has no string `result` (for example because the 1 MiB tail cut off its
//! start), gives an empty final message and one line on standard error. The exit status then decides: not 0 is a failed
//! session, and 0 is a missing result line. A reply with `is_error: true` is a failed session, even when the exit
//! status is 0.
//!
//! The trust re-check is not here. The runner puts `GuardedHarness` in front of this harness.

use workflow_core::json::{self, Json};
use workflow_core::limits::MAX_SESSION_OUTPUT_BYTES;
use workflow_core::ports::{
    AgentCatalog, AgentTools, Harness, Launch, LaunchEnd, ProcessGroup, ProcessLauncher, Runner,
    Session, SessionEnd, SessionOutcome,
};
use workflow_core::trust::plain;

use crate::agent_catalog::FileAgentCatalog;

/// What the runner passes as `--allowedTools` for one agent definition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolRules {
    /// No flag: the definition has no `tools` key (every tool is available and none is pre-approved), or an empty list.
    None,
    /// The rules, one for each tool, in list order, each once.
    Rules(Vec<String>),
    /// No flag, because the list cannot be passed without the risk of granting more than it names. The text says why
    /// and names the item.
    Unknown(String),
}

/// Whether `name` is a tool name that can go into the comma-separated `--allowedTools` argument unchanged: letters,
/// digits and `_ * : . -`. A space or a comma would make Claude read one item as two. A leading `-` is accepted.
pub fn is_rule_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '*' | ':' | '.' | '-'))
}

/// The rules for one item of a `tools` list. `Agent(a, b)` is `Agent(a)` and `Agent(b)`. Any other name is its own rule
/// when it is a plain name, so `Agent` and `mcp__x__*` pass through. `None` for anything else.
fn item_rules(item: &str) -> Option<Vec<String>> {
    if let Some(inner) = item
        .strip_prefix("Agent(")
        .and_then(|rest| rest.strip_suffix(')'))
    {
        let names: Vec<&str> = inner.split(',').map(str::trim).collect();
        return names
            .iter()
            .all(|n| is_rule_name(n))
            .then(|| names.iter().map(|n| format!("Agent({n})")).collect());
    }
    is_rule_name(item).then(|| vec![item.to_string()])
}

/// The `--allowedTools` rules for the tools of an agent definition. One item that cannot be mapped makes the whole list
/// [`ToolRules::Unknown`], so the session gets less and never more.
pub fn tool_rules(tools: &AgentTools) -> ToolRules {
    let names = match tools {
        AgentTools::Listed(names) => names,
        AgentTools::EveryToolNonePreApproved => return ToolRules::None,
        AgentTools::Unknown(why) => return ToolRules::Unknown(why.clone()),
    };
    let mut rules: Vec<String> = Vec::new();
    for item in names {
        let Some(found) = item_rules(item) else {
            return ToolRules::Unknown(format!(
                "the tool `{}` in its `tools` key is not a form the runner can pass as an `--allowedTools` rule",
                plain(item)
            ));
        };
        for rule in found {
            if !rules.contains(&rule) {
                rules.push(rule);
            }
        }
    }
    if rules.is_empty() {
        ToolRules::None
    } else {
        ToolRules::Rules(rules)
    }
}

/// The arguments of `claude` for one stage.
pub fn claude_args(agent: &str, rules: &[String], prompt: &str) -> Vec<String> {
    let mut args = vec![
        "-p".to_string(),
        prompt.to_string(),
        "--output-format".to_string(),
        "json".to_string(),
        "--agent".to_string(),
        agent.to_string(),
    ];
    if !rules.is_empty() {
        args.push("--allowedTools".to_string());
        args.push(rules.join(","));
    }
    args
}

/// What the standard output of `claude -p --output-format json` held.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reply {
    /// The `result` field.
    Result(String),
    /// A reply with `is_error: true`. The text is its `result`, or else its `subtype`, or empty.
    Failed(String),
    /// Not JSON, not an object, or no string `result`.
    Unreadable,
}

/// Reads the reply of a session.
pub fn read_reply(stdout: &str) -> Reply {
    let Ok(value) = json::parse(stdout) else {
        return Reply::Unreadable;
    };
    let text = |key: &str| value.get(key).and_then(Json::as_str).map(str::to_string);
    if value.get("is_error") == Some(&Json::Bool(true)) {
        return Reply::Failed(
            text("result")
                .or_else(|| text("subtype"))
                .unwrap_or_default(),
        );
    }
    match text("result") {
        Some(result) => Reply::Result(result),
        None => Reply::Unreadable,
    }
}

/// Runs each stage in a headless Claude Code session.
pub struct ClaudeHarness<'a> {
    launcher: &'a mut dyn ProcessLauncher,
    catalog: &'a FileAgentCatalog,
    program: String,
    /// The folder a session starts in: the project root (D25).
    cwd: String,
    /// Told one line when a session does not end well, with the stage and why.
    note: Box<dyn FnMut(&str) + 'a>,
}

impl<'a> ClaudeHarness<'a> {
    /// `program` is `claude`, or the path of another program in a test. `catalog` must look where Claude Code does: the
    /// project root and the folders above it up to the git top folder, then the home folder.
    pub fn new(
        launcher: &'a mut dyn ProcessLauncher,
        catalog: &'a FileAgentCatalog,
        program: &str,
        cwd: &str,
        note: Box<dyn FnMut(&str) + 'a>,
    ) -> ClaudeHarness<'a> {
        ClaudeHarness {
            launcher,
            catalog,
            program: program.to_string(),
            cwd: cwd.to_string(),
            note,
        }
    }

    fn refuse(&mut self, stage: &str, why: &str) -> SessionOutcome {
        (self.note)(&format!("stage `{stage}` did not start: {why}"));
        SessionOutcome {
            end: SessionEnd::NotStarted,
            final_message: String::new(),
        }
    }
}

impl Harness for ClaudeHarness<'_> {
    fn run_session(&mut self, session: &Session) -> SessionOutcome {
        self.run_session_recorded(session, &mut |_| {})
    }

    fn run_session_recorded(
        &mut self,
        session: &Session,
        started: &mut dyn FnMut(&ProcessGroup),
    ) -> SessionOutcome {
        let stage = session.stage;
        let Some(definition) = self
            .catalog
            .definitions(session.agent)
            .into_iter()
            .find(|d| d.runner == Runner::Claude)
        else {
            return self.refuse(
                stage,
                &format!("Claude Code cannot see the agent `{}`.", session.agent),
            );
        };
        let rules = match tool_rules(&definition.tools) {
            ToolRules::Rules(rules) => rules,
            ToolRules::None => Vec::new(),
            ToolRules::Unknown(why) => {
                (self.note)(&format!(
                    "stage `{stage}`: no tool is pre-approved for the session, because {why}."
                ));
                Vec::new()
            }
        };
        let args = claude_args(session.agent, &rules, session.prompt);
        let launched = self.launcher.launch(
            &Launch {
                program: &self.program,
                args: &args,
                cwd: &self.cwd,
                time_limit_ms: session.time_limit_ms,
                keep_output_bytes: MAX_SESSION_OUTPUT_BYTES,
            },
            started,
        );
        let (end, final_message) = match launched.end {
            LaunchEnd::Exited(code) => match read_reply(&launched.output) {
                Reply::Result(result) => {
                    if code != 0 {
                        (self.note)(&format!(
                            "stage `{stage}`: the Claude Code session ended with exit status {code}."
                        ));
                    }
                    (SessionEnd::Exited(code), result)
                }
                Reply::Failed(text) => {
                    (self.note)(&format!(
                        "stage `{stage}`: the Claude Code session reported an error: {}",
                        plain(&text)
                    ));
                    // A reply that says it failed is a failed session even when the status says 0.
                    (
                        SessionEnd::Exited(if code == 0 { 1 } else { code }),
                        String::new(),
                    )
                }
                Reply::Unreadable => {
                    (self.note)(&format!(
                        "stage `{stage}`: the Claude Code session ended with exit status {code} and printed no JSON \
                         reply with a `result`."
                    ));
                    (SessionEnd::Exited(code), String::new())
                }
            },
            LaunchEnd::TimedOut => {
                (self.note)(&format!(
                    "stage `{stage}`: the Claude Code session passed its time limit and was stopped."
                ));
                (SessionEnd::TimedOut, String::new())
            }
            LaunchEnd::NotStarted(why) => {
                (self.note)(&format!(
                    "stage `{stage}`: the Claude Code session could not start: {why}"
                ));
                (SessionEnd::NotStarted, String::new())
            }
        };
        SessionOutcome { end, final_message }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listed(items: &[&str]) -> AgentTools {
        AgentTools::Listed(items.iter().map(|s| (*s).to_string()).collect())
    }

    fn rules(items: &[&str]) -> ToolRules {
        tool_rules(&listed(items))
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn the_prompt_follows_dash_p_and_the_rules_come_last() {
        let args = claude_args("k-a", &strings(&["Read", "Agent(b)"]), "Goal: x");
        assert_eq!(
            args,
            [
                "-p",
                "Goal: x",
                "--output-format",
                "json",
                "--agent",
                "k-a",
                "--allowedTools",
                "Read,Agent(b)"
            ]
        );
    }

    #[test]
    fn no_rules_means_no_allowed_tools_flag_and_never_a_permission_flag() {
        let args = claude_args("k-a", &[], "p");
        assert_eq!(
            args,
            ["-p", "p", "--output-format", "json", "--agent", "k-a"]
        );
        let all = claude_args("k-a", &strings(&["Read"]), "p").join(" ");
        assert!(
            !all.contains("permission")
                && !all.contains("dangerously")
                && !all.contains("--agents")
        );
    }

    #[test]
    fn the_prompt_is_one_argument_whatever_it_holds() {
        let prompt = "Goal: a b\n--allowedTools Bash \"q\" $HOME";
        let args = claude_args("a", &strings(&["Read"]), prompt);
        assert_eq!(args[1], prompt);
        assert_eq!(args.iter().filter(|a| *a == "--allowedTools").count(), 1);
    }

    #[test]
    fn an_agent_list_becomes_one_rule_for_each_name_and_a_bare_agent_stays() {
        assert_eq!(
            rules(&["Agent(a, b)"]),
            ToolRules::Rules(strings(&["Agent(a)", "Agent(b)"]))
        );
        assert_eq!(rules(&["Agent"]), ToolRules::Rules(strings(&["Agent"])));
        assert_eq!(
            rules(&["Agent(k-x)"]),
            ToolRules::Rules(strings(&["Agent(k-x)"]))
        );
    }

    #[test]
    fn mcp_patterns_and_plain_names_pass_through_and_a_mixed_list_keeps_its_order() {
        assert_eq!(
            rules(&["Read", "mcp__aws-mcp__*", "Agent(a, b)", "WebFetch", "Read"]),
            ToolRules::Rules(strings(&[
                "Read",
                "mcp__aws-mcp__*",
                "Agent(a)",
                "Agent(b)",
                "WebFetch"
            ]))
        );
    }

    #[test]
    fn no_tools_key_an_empty_list_and_an_unknown_list_pre_approve_nothing() {
        assert_eq!(
            tool_rules(&AgentTools::EveryToolNonePreApproved),
            ToolRules::None
        );
        assert_eq!(rules(&[]), ToolRules::None);
        assert!(matches!(
            tool_rules(&AgentTools::Unknown("x".into())),
            ToolRules::Unknown(_)
        ));
    }

    #[test]
    fn one_item_that_cannot_be_passed_makes_the_whole_list_unknown_and_names_it() {
        for bad in [
            "Read Bash",
            "Read,Bash",
            "Agent(a",
            "Agent(a))",
            "Agent()",
            "Agent(a,)",
            "Agent(a b)",
            "Bash(git *)",
            "Read)",
        ] {
            match rules(&["Write", bad]) {
                ToolRules::Unknown(why) => {
                    assert!(why.contains(bad), "{bad}: {why}");
                }
                other => panic!("{bad}: {other:?}"),
            }
        }
    }

    #[test]
    fn a_name_that_starts_with_a_dash_is_accepted_by_the_pattern() {
        assert!(is_rule_name("-x"));
        assert_eq!(rules(&["-x"]), ToolRules::Rules(strings(&["-x"])));
        assert!(!is_rule_name(""));
        assert!(!is_rule_name("a b") && !is_rule_name("a,b") && !is_rule_name("a(b)"));
    }

    #[test]
    fn the_reply_is_read_from_its_result_field() {
        assert_eq!(
            read_reply(
                r#"{"type":"result","is_error":false,"result":"hi\nKONDUCTOR_RESULT {}","usage":{"x":1.5}}"#
            ),
            Reply::Result("hi\nKONDUCTOR_RESULT {}".to_string())
        );
        assert_eq!(
            read_reply("  {\"result\":\"\"}\n"),
            Reply::Result(String::new())
        );
    }

    #[test]
    fn a_reply_that_is_not_json_or_has_no_string_result_is_unreadable() {
        for text in [
            "",
            "plain text",
            "{\"result\":",
            "[]",
            "{\"result\":3}",
            "{}",
            "{\"a\":1} x",
        ] {
            assert_eq!(read_reply(text), Reply::Unreadable, "{text:?}");
        }
    }

    #[test]
    fn an_error_reply_is_a_failure_with_its_text() {
        assert_eq!(
            read_reply(r#"{"is_error":true,"result":"Not logged in"}"#),
            Reply::Failed("Not logged in".to_string())
        );
        assert_eq!(
            read_reply(r#"{"is_error":true,"subtype":"error_max_turns"}"#),
            Reply::Failed("error_max_turns".to_string())
        );
        assert_eq!(
            read_reply(r#"{"is_error":true}"#),
            Reply::Failed(String::new())
        );
    }
}
