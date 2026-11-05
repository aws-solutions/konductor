// SPDX-License-Identifier: Apache-2.0
//
// flow.rs: `konductor flow check <name>`, `konductor flow show <name>` and `konductor flow run <name>`.
//
// The format, its checks, the stage prompt, the runner and the JSON they print live in the `workflow-core` crate,
// which does no IO. The file source, lookup, run store, lock and the `fake` harness live in `workflow-adapters`. This
// module only wires them to the command line and decides the output and the exit code.
//
// Exit codes: 0 when the workflow has no errors (and, for `run`, the run passed), 1 when a run halted, 64 for a usage
// error (a bad name, `library/<name>`, a name that matches no file, or a bad `run` input), 65 when the workflow has
// errors, 75 when the workspace lock refuses the run. Never 2, which the CLI reserves.
//
// A bare name is looked up in `<project>/.konductor/workflows/` and then in `~/.konductor/workflows/`. The project is
// the current directory, as for `init` and `config`. `library/<name>` names a shipped workflow, and none exist yet.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use workflow_adapters::process::current_owner;
use workflow_adapters::{
    choose_harness, FakeHarness, FileRunLock, FileRunStore, HarnessChoice, Located, Lookup, Scope,
    Script, SimulatedClock, Skip, Skipped, FAKE_SCRIPT_ENV,
};
use workflow_core::json::Json;
use workflow_core::ports::RunLock;
use workflow_core::run::{Run, RunStatus, StageState, StageStatus};
use workflow_core::runner::{execute, prepare, start, StartError};
use workflow_core::{check_text, parse_reference, Checked, Reference, ReferenceError};

use crate::cli::output::{self, status, ColorMode};
use crate::cli::FlowAction;

/// A run halted: a stage was blocked. Also any failure while a run is under way, such as a state file that cannot be
/// written, which is the CLI's "halted (runtime error)".
const EXIT_HALTED: u8 = 1;
const EXIT_USAGE_ERROR: u8 = 64;
/// The workflow has errors. Same number as the CLI's other state or verification failures.
const EXIT_WORKFLOW_ERRORS: u8 = 65;
/// The workspace lock refuses the run (`EX_TEMPFAIL`): another process holds it. The `--json` envelope's `code` says
/// whether its run is known.
const EXIT_ALREADY_RUNNING: u8 = 75;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Command {
    Check,
    Show,
}

/// What one run of a `flow` command needs besides the name. The folders are passed in so tests can point at scratch
/// ones.
struct Context<'a> {
    project_root: &'a Path,
    home: Option<&'a Path>,
    json: bool,
    color: ColorMode,
}

/// The inputs of `flow run` besides the name.
struct RunArgs {
    goal: Option<String>,
    harness: String,
    fake_script: Option<PathBuf>,
    /// The value of `KONDUCTOR_FAKE_SCRIPT`.
    fake_script_env: Option<OsString>,
}

/// `cwd` is the project root. The caller resolves it through the shared helper, so a failure to find it is reported the
/// way it is for the other commands, with telemetry and the command-agnostic `--json` envelope.
pub(crate) fn dispatch_flow(action: FlowAction, cwd: &Path, json: bool, color: ColorMode) -> u8 {
    let home = crate::cli::install::index::env_home_dir();
    let context = Context {
        project_root: cwd,
        home: home.as_deref(),
        json,
        color,
    };
    let (out, err) = (&mut std::io::stdout(), &mut std::io::stderr());
    match action {
        FlowAction::Check { name } => run(Command::Check, &context, &name, out, err),
        FlowAction::Show { name } => run(Command::Show, &context, &name, out, err),
        FlowAction::Run {
            name,
            goal,
            harness,
            fake_script,
        } => {
            let args = RunArgs {
                goal,
                harness,
                fake_script,
                fake_script_env: std::env::var_os(FAKE_SCRIPT_ENV),
            };
            run_workflow(&context, &name, &args, out, err)
        }
    }
}

fn scope_name(scope: Scope) -> &'static str {
    match scope {
        Scope::Project => "project",
        Scope::User => "user",
    }
}

/// The stable word for why a file was passed over, as `flow check --json` writes it.
fn skip_word(skip: Skip) -> &'static str {
    match skip {
        Skip::Link => "link",
        Skip::NotRegular => "not_regular",
        Skip::TooLarge => "too_large",
        Skip::NotUtf8 => "not_utf8",
        Skip::Unreadable => "unreadable",
    }
}

/// The check report with the file it is about. `scope` says which folder the file came from, and `skipped` lists the
/// nearer files that were passed over. Both are additions to the canvas contract's check result, which has room for
/// them. The resolved workflow of `flow show` has neither, so its bytes depend on the workflow alone.
fn report_with_provenance(checked: &Checked, scope: Scope, skipped: &[Skipped]) -> Json {
    let mut report = checked.report_json();
    report.insert("scope", Json::str(scope_name(scope)));
    let list = skipped
        .iter()
        .map(|s| {
            let mut entry = Json::object();
            entry.insert("scope", Json::str(scope_name(s.scope)));
            entry.insert("reason", Json::str(skip_word(s.reason)));
            entry
        })
        .collect();
    report.insert("skipped", Json::Array(list));
    report
}

/// One sentence per file that lookup passed over, such as "Skipped the project file plan.yml because it is a link."
fn skipped_sentences(skipped: &[Skipped], name: &str) -> Vec<String> {
    skipped
        .iter()
        .map(|s| {
            format!(
                "Skipped the {} file {name}.yml because it {}.",
                scope_name(s.scope),
                s.reason.reason()
            )
        })
        .collect()
}

/// The workflow a name refers to, or the exit code of the usage error that was reported.
fn find(
    context: &Context,
    name: &str,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> Result<(String, workflow_adapters::Found, Vec<Skipped>), u8> {
    let name = match parse_reference(name) {
        Ok(Reference::Local(name)) => name,
        Ok(Reference::Shipped(_)) => {
            let message = "Shipped workflows (`library/<name>`) are not available yet.";
            return Err(usage_error(message, context, out, err));
        }
        Err(ReferenceError::InvalidName) => {
            let message = format!("A workflow name {}.", workflow_core::rules::NAME_RULE);
            return Err(usage_error(&message, context, out, err));
        }
    };
    let Located { found, skipped } = Lookup::new(context.project_root, context.home).find(&name);
    let Some(found) = found else {
        let searched = if context.home.is_some() {
            "in the current directory and in your home folder."
        } else {
            "in the current directory. HOME is not set, so the home folder was not searched."
        };
        let mut message = format!(
            "No workflow named `{name}`. Looked for `.konductor/workflows/{name}.yml` {searched}"
        );
        for sentence in skipped_sentences(&skipped, &name) {
            message.push(' ');
            message.push_str(&sentence);
        }
        return Err(usage_error(&message, context, out, err));
    };
    // The user can only tell which file was used if they are told, and told what was passed over to reach it.
    if !context.json {
        for sentence in skipped_sentences(&skipped, &name) {
            let _ = writeln!(err, "note: {sentence}");
        }
    }
    Ok((name, found, skipped))
}

/// Runs `flow check` or `flow show`.
fn run(
    command: Command,
    context: &Context,
    name: &str,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    let (name, found, skipped) = match find(context, name, out, err) {
        Ok(found) => found,
        Err(code) => return code,
    };
    let checked = check_text(&name, &found.text, &found.source);
    let code = if checked.is_valid() {
        0
    } else {
        EXIT_WORKFLOW_ERRORS
    };
    match command {
        Command::Check => print_check(&checked, &found.scope, &skipped, context, out),
        Command::Show => print_show(&checked, found.scope, &skipped, context.json, out, err),
    }
    code
}

/// Runs `flow run`. The checks that can refuse the run come first, and nothing is written until they pass: the name,
/// the harness, the workflow, the goal and the prompts, and the fake script.
fn run_workflow(
    context: &Context,
    name: &str,
    args: &RunArgs,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    let choice = match choose_harness(
        &args.harness,
        args.fake_script.as_deref(),
        args.fake_script_env.as_deref(),
    ) {
        Ok(choice) => choice,
        Err(refusal) => return usage_error(&refusal.to_string(), context, out, err),
    };
    let (name, found, skipped) = match find(context, name, out, err) {
        Ok(found) => found,
        Err(code) => return code,
    };
    let checked = check_text(&name, &found.text, &found.source);
    let Some(workflow) = checked.workflow.clone() else {
        print_show(&checked, found.scope, &skipped, context.json, out, err);
        return EXIT_WORKFLOW_ERRORS;
    };
    // Slice 1 has no params other than `goal`.
    let prepared = match prepare(workflow, args.goal.as_deref(), &BTreeMap::new()) {
        Ok(prepared) => prepared,
        Err(error) => return usage_error(&error.message(), context, out, err),
    };
    let HarnessChoice::Fake { script } = &choice;
    let script = match Script::load(script) {
        Ok(script) => script,
        Err(why) => {
            let message = format!("The fake script cannot be used: {why}.");
            return usage_error(&message, context, out, err);
        }
    };

    let mut store = match FileRunStore::open(context.project_root) {
        Ok(store) => store,
        Err(error) => return runtime_error(&error.0, context, out, err),
    };
    let mut lock = FileRunLock::new(context.project_root);
    let Some(owner) = current_owner() else {
        let message = "The start time of this process cannot be read, so the run cannot hold the workspace lock.";
        return runtime_error(message, context, out, err);
    };
    let clock = Rc::new(SimulatedClock::default());
    let started = match start(
        &prepared,
        choice.name(),
        owner,
        &mut store,
        &mut lock,
        &*clock,
    ) {
        Ok(started) => started,
        Err(error) => return refused(&error, &lock, context, out, err),
    };
    if !context.json {
        for ended in &started.recovered {
            let _ = writeln!(
                err,
                "note: Run {} was left running by process {}, which is gone. It now reads as {}.",
                ended.run_id,
                ended.owner.pid,
                ended.status.as_str()
            );
        }
    }
    let mut run = started.run;
    let mut harness = FakeHarness::new(script, Rc::clone(&clock));
    let json = context.json;
    let mut report = |stage: &StageState| {
        if !json {
            let _ = writeln!(out, "{}", stage_line(stage));
        }
    };
    let executed = execute(
        &mut run,
        &prepared,
        &mut harness,
        &*clock,
        &mut store,
        &mut report,
    );
    lock.release();
    if let Err(error) = executed {
        return runtime_error(&error.0, context, out, err);
    }
    print_run(&run, context, out);
    match run.status {
        RunStatus::Passed => 0,
        _ => EXIT_HALTED,
    }
}

/// `stage plan: passed`, or `stage plan: blocked (RESULT_MISSING)`.
fn stage_line(stage: &StageState) -> String {
    match stage.status {
        StageStatus::Blocked(reason) => {
            format!("stage {}: blocked ({})", stage.name, reason.as_str())
        }
        status => format!("stage {}: {}", stage.name, status.as_str()),
    }
}

fn print_run(run: &Run, context: &Context, out: &mut dyn Write) {
    if context.json {
        let _ = writeln!(out, "{}", run.to_json().compact());
        return;
    }
    let word = run.status.as_str();
    let label = match run.status {
        RunStatus::Passed => status::ok(context.color, word),
        _ => status::error(context.color, word),
    };
    let _ = writeln!(out, "run {}: {label}", run.run_id);
}

/// A run that did not start because of the lock (exit 75), or because a file could not be written (exit 1).
fn refused(
    error: &StartError,
    lock: &FileRunLock,
    context: &Context,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    // Both codes mean that another process holds the lock. Only `already_running` names its run.
    let (code, message) = match error {
        StartError::AlreadyRunning(holder) => (
            "already_running",
            format!(
                "Another run is active in this workspace: run {}, owned by process {}. Try again when it ends.",
                holder.run_id, holder.owner.pid
            ),
        ),
        StartError::UnreadableLock => (
            "lock_unreadable",
            format!(
                "The workspace lock {} is held but its record cannot be read, or another start is taking it at this \
                 moment. Which run is active is not known. Try again in a moment.",
                lock.path().display()
            ),
        ),
        StartError::Port(error) => return runtime_error(&error.0, context, out, err),
    };
    if context.json {
        let mut extra = vec![("code", serde_json::Value::from(code))];
        if let StartError::AlreadyRunning(holder) = error {
            extra.push(("run_id", serde_json::Value::from(holder.run_id.as_str())));
            extra.push(("pid", serde_json::Value::from(holder.owner.pid)));
        }
        let envelope = crate::cli::report::build_error_json("flow", &message, extra);
        let _ = writeln!(out, "{envelope}");
    } else {
        let prefix = output::error_prefix(context.color, "konductor flow:");
        let _ = writeln!(err, "{prefix} {message}");
    }
    EXIT_ALREADY_RUNNING
}

/// A failure to read or write the run state, exit 1.
fn runtime_error(message: &str, context: &Context, out: &mut dyn Write, err: &mut dyn Write) -> u8 {
    if context.json {
        let envelope = crate::cli::report::build_error_json("flow", message, Vec::new());
        let _ = writeln!(out, "{envelope}");
    } else {
        let prefix = output::error_prefix(context.color, "konductor flow:");
        let _ = writeln!(err, "{prefix} {message}");
    }
    EXIT_HALTED
}

fn usage_error(message: &str, context: &Context, out: &mut dyn Write, err: &mut dyn Write) -> u8 {
    report_usage_error(message, context.json, context.color, out, err)
}

/// A usage error of the command itself (a bad or unknown name). These stay local, with no telemetry event, because
/// `flow` only reads files and a mistyped name is not a fault worth reporting. A failure to find the current directory
/// is different, and goes through the shared helper in `dispatch.rs`.
///
/// The CLI's `{command, error}` envelope on stdout under `--json`, a line on stderr otherwise.
fn report_usage_error(
    message: &str,
    json: bool,
    color: ColorMode,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    if json {
        let envelope = crate::cli::report::build_error_json("flow", message, Vec::new());
        let _ = writeln!(out, "{envelope}");
    } else {
        let prefix = output::error_prefix(color, "konductor flow:");
        let _ = writeln!(err, "{prefix} {message}");
    }
    EXIT_USAGE_ERROR
}

fn print_check(
    checked: &Checked,
    scope: &Scope,
    skipped: &[Skipped],
    context: &Context,
    out: &mut dyn Write,
) {
    let scope = *scope;
    if context.json {
        let _ = writeln!(
            out,
            "{}",
            report_with_provenance(checked, scope, skipped).compact()
        );
        return;
    }
    if checked.is_valid() {
        let stages = checked.stage_count;
        let plural = if stages == 1 { "" } else { "s" };
        let _ = writeln!(
            out,
            "{} {} ({}, {stages} stage{plural})",
            status::ok(context.color, "ok:"),
            checked.name,
            scope_name(scope)
        );
        return;
    }
    write_diagnostics(checked, Some(scope), context.color, out);
}

fn print_show(
    checked: &Checked,
    scope: Scope,
    skipped: &[Skipped],
    json: bool,
    out: &mut dyn Write,
    err: &mut dyn Write,
) {
    match &checked.workflow {
        Some(workflow) => {
            let _ = writeln!(out, "{}", workflow.to_json().pretty());
        }
        // A workflow with errors has no resolved form. In `--json` mode the report goes to stdout, so a script reads
        // one stream. Otherwise it goes to stderr, and stdout stays empty rather than hold something that is not the
        // workflow.
        None if json => {
            let report = report_with_provenance(checked, scope, skipped);
            let _ = writeln!(out, "{}", report.compact());
        }
        // The color helpers follow the state of stdout, so a line for stderr is written plain.
        None => write_diagnostics(checked, None, ColorMode::disabled(), err),
    }
}

fn write_diagnostics(
    checked: &Checked,
    scope: Option<Scope>,
    color: ColorMode,
    out: &mut dyn Write,
) {
    for d in &checked.diagnostics {
        let _ = writeln!(
            out,
            "{}:{}:{}: {} {}: {}",
            d.file,
            d.line,
            d.column,
            status::error(color, d.severity.as_str()),
            d.code.as_str(),
            d.message
        );
        if let Some(suggestion) = &d.suggestion {
            let _ = writeln!(out, "    suggestion: {suggestion}");
        }
    }
    let count = checked.errors();
    let plural = if count == 1 { "" } else { "s" };
    let place = scope.map_or(String::new(), |s| format!(" ({})", scope_name(s)));
    let _ = writeln!(out, "{}{place}: {count} error{plural}", checked.name);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    const VALID: &str = "format: konductor/1\nversion: 0.1.0\nintent:\n  outcome: Do it.\nstages:\n  - name: plan\n    agent: k-architect\n";

    /// A project folder and a home folder.
    struct Scratch(PathBuf, PathBuf);

    impl Scratch {
        fn new(label: &str) -> Scratch {
            let dir = std::env::temp_dir().join(format!(
                "konductor-flow-{label}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(dir.join(".konductor/workflows")).unwrap();
            let home = dir.join("home");
            fs::create_dir_all(home.join(".konductor/workflows")).unwrap();
            Scratch(dir, home)
        }

        fn write(&self, name: &str, text: &str) {
            fs::write(self.0.join(".konductor/workflows").join(name), text).unwrap();
        }

        fn write_user(&self, name: &str, text: &str) {
            fs::write(self.1.join(".konductor/workflows").join(name), text).unwrap();
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn run_in(scratch: &Scratch, command: Command, name: &str, json: bool) -> (u8, String, String) {
        run_with(scratch, Some(&scratch.1), command, name, json)
    }

    fn run_with(
        scratch: &Scratch,
        home: Option<&Path>,
        command: Command,
        name: &str,
        json: bool,
    ) -> (u8, String, String) {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let context = Context {
            project_root: &scratch.0,
            home,
            json,
            color: ColorMode::disabled(),
        };
        let code = run(command, &context, name, &mut out, &mut err);
        (
            code,
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
        )
    }

    #[test]
    fn check_of_a_valid_workflow_exits_0_and_says_so() {
        let scratch = Scratch::new("ok");
        scratch.write("plan.yml", VALID);
        let (code, out, err) = run_in(&scratch, Command::Check, "plan", false);
        assert_eq!(
            (code, out.as_str(), err.as_str()),
            (0, "ok: plan (project, 1 stage)\n", "")
        );
    }

    #[test]
    fn check_of_a_broken_workflow_exits_65_and_lists_each_problem_with_its_place() {
        let scratch = Scratch::new("broken");
        scratch.write("plan.yml", &VALID.replace("0.1.0", "'1.1'"));
        let (code, out, err) = run_in(&scratch, Command::Check, "plan", false);
        assert_eq!(code, EXIT_WORKFLOW_ERRORS);
        assert!(
            out.starts_with("plan.yml:2:10: error INVALID_VALUE: "),
            "{out}"
        );
        assert!(out.contains("    suggestion: 0.1.0\n"), "{out}");
        assert!(out.ends_with("plan (project): 1 error\n"), "{out}");
        assert_eq!(err, "");
    }

    #[test]
    fn check_json_prints_the_report_and_exits_65_on_errors() {
        let scratch = Scratch::new("json");
        scratch.write("plan.yml", &VALID.replace("0.1.0", "'1.1'"));
        let (code, out, _) = run_in(&scratch, Command::Check, "plan", true);
        assert_eq!(code, EXIT_WORKFLOW_ERRORS);
        assert!(out.contains("\"code\":\"INVALID_VALUE\""), "{out}");
        assert!(out.contains("\"valid\":false"), "{out}");
        assert_eq!(out.lines().count(), 1);
    }

    #[test]
    fn show_prints_the_resolved_workflow_as_json() {
        let scratch = Scratch::new("show");
        scratch.write("plan.yml", VALID);
        let (code, out, err) = run_in(&scratch, Command::Show, "plan", false);
        assert_eq!(code, 0);
        assert!(
            out.starts_with("{\n  \"format\": \"konductor/1\",\n"),
            "{out}"
        );
        assert!(out.ends_with("}\n"), "{out}");
        assert_eq!(err, "");
        assert_eq!(run_in(&scratch, Command::Show, "plan", true).1, out);
    }

    #[test]
    fn show_of_a_broken_workflow_exits_65_and_keeps_stdout_clean() {
        let scratch = Scratch::new("show-broken");
        scratch.write("plan.yml", "a: [");
        let (code, out, err) = run_in(&scratch, Command::Show, "plan", false);
        assert_eq!((code, out.as_str()), (EXIT_WORKFLOW_ERRORS, ""));
        assert!(err.contains("YAML_SYNTAX"), "{err}");
        let (code, out, err) = run_in(&scratch, Command::Show, "plan", true);
        assert_eq!((code, err.as_str()), (EXIT_WORKFLOW_ERRORS, ""));
        assert!(out.contains("\"code\":\"YAML_SYNTAX\""), "{out}");
    }

    #[test]
    fn a_bad_name_and_a_shipped_name_are_usage_errors() {
        let scratch = Scratch::new("usage");
        for name in ["Bad", "../x", "a/b", "", "x.yml"] {
            let (code, out, err) = run_in(&scratch, Command::Check, name, false);
            assert_eq!((code, out.as_str()), (EXIT_USAGE_ERROR, ""), "{name:?}");
            assert!(
                err.starts_with("konductor flow: A workflow name must use"),
                "{err}"
            );
        }
        let (code, _, err) = run_in(&scratch, Command::Show, "library/x", false);
        assert_eq!(code, EXIT_USAGE_ERROR);
        assert!(err.contains("are not available yet"), "{err}");
    }

    #[test]
    fn a_name_that_matches_no_file_is_a_usage_error() {
        let scratch = Scratch::new("none");
        let (code, _, err) = run_in(&scratch, Command::Check, "ghost", false);
        assert_eq!(code, EXIT_USAGE_ERROR);
        assert!(err.contains("No workflow named `ghost`"), "{err}");
    }

    #[test]
    fn usage_errors_use_the_json_envelope_under_json() {
        let scratch = Scratch::new("usage-json");
        let (code, out, err) = run_in(&scratch, Command::Check, "library/x", true);
        assert_eq!((code, err.as_str()), (EXIT_USAGE_ERROR, ""));
        assert!(out.starts_with("{\"command\":\"flow\",\"error\":"), "{out}");
    }

    #[test]
    fn the_ok_line_says_which_folder_the_workflow_came_from() {
        let scratch = Scratch::new("scope");
        scratch.write_user("plan.yml", VALID);
        let (code, out, err) = run_in(&scratch, Command::Check, "plan", false);
        assert_eq!(
            (code, out.as_str(), err.as_str()),
            (0, "ok: plan (user, 1 stage)\n", "")
        );
    }

    #[test]
    fn a_project_file_that_was_passed_over_is_named_in_a_note() {
        let scratch = Scratch::new("skipped");
        scratch.write("big.yml", &"#".repeat(262_145));
        scratch.write_user("big.yml", VALID.replace("plan", "big").as_str());
        let (code, out, err) = run_with(&scratch, Some(&scratch.1), Command::Check, "big", false);
        assert_eq!(code, 0, "{out} {err}");
        assert_eq!(out, "ok: big (user, 1 stage)\n");
        assert_eq!(
            err,
            "note: Skipped the project file big.yml because it is over 256 KiB.\n"
        );
        // The note is for people. Under --json the streams hold only the report.
        let (_, out, err) = run_with(&scratch, Some(&scratch.1), Command::Check, "big", true);
        assert_eq!(err, "");
        assert!(out.contains("\"valid\":true"), "{out}");
    }

    #[test]
    fn show_keeps_stdout_to_the_json_when_a_file_was_passed_over() {
        let scratch = Scratch::new("skipped-show");
        fs::write(
            scratch.0.join(".konductor/workflows/plan.yml"),
            [0xff_u8, 0xfe],
        )
        .unwrap();
        scratch.write_user("plan.yml", VALID);
        let (code, out, err) = run_in(&scratch, Command::Show, "plan", false);
        assert_eq!(code, 0, "{err}");
        assert!(out.starts_with("{\n"), "{out}");
        assert!(
            err.starts_with("note: Skipped the project file plan.yml"),
            "{err}"
        );
    }

    #[test]
    fn a_missing_name_names_the_files_that_were_passed_over() {
        let scratch = Scratch::new("skipped-missing");
        scratch.write("big.yml", &"#".repeat(262_145));
        let (code, _, err) = run_with(&scratch, None, Command::Check, "big", false);
        assert_eq!(code, EXIT_USAGE_ERROR);
        assert!(
            err.contains(
                "in the current directory. HOME is not set, so the home folder was not searched."
            ),
            "{err}"
        );
        assert!(
            err.contains("Skipped the project file big.yml because it is over 256 KiB."),
            "{err}"
        );
    }

    #[test]
    fn with_a_home_folder_the_message_says_it_was_searched() {
        let scratch = Scratch::new("with-home");
        let (code, _, err) = run_in(&scratch, Command::Check, "ghost", false);
        assert_eq!(code, EXIT_USAGE_ERROR);
        assert!(
            err.contains("in the current directory and in your home folder."),
            "{err}"
        );
        assert!(!err.contains("HOME is not set"), "{err}");
    }

    #[test]
    fn the_json_report_says_which_file_was_checked_and_what_was_passed_over() {
        let scratch = Scratch::new("provenance");
        scratch.write_user("plan.yml", VALID);
        let (_, out, _) = run_in(&scratch, Command::Check, "plan", true);
        assert!(out.contains("\"scope\":\"user\",\"skipped\":[],"), "{out}");
        scratch.write("plan.yml", &"#".repeat(262_145));
        let (_, out, _) = run_in(&scratch, Command::Check, "plan", true);
        assert!(
            out.contains(
                "\"scope\":\"user\",\"skipped\":[{\"reason\":\"too_large\",\"scope\":\"project\"}]"
            ),
            "{out}"
        );
    }

    #[test]
    fn the_failure_report_of_show_has_the_same_fields_and_a_good_show_has_neither() {
        let scratch = Scratch::new("provenance-show");
        fs::write(
            scratch.0.join(".konductor/workflows/plan.yml"),
            [0xff_u8, 0xfe],
        )
        .unwrap();
        scratch.write_user("plan.yml", &VALID.replace("0.1.0", "9"));
        let (code, out, _) = run_in(&scratch, Command::Show, "plan", true);
        assert_eq!(code, EXIT_WORKFLOW_ERRORS);
        assert!(
            out.contains("\"scope\":\"user\"") && out.contains("\"reason\":\"not_utf8\""),
            "{out}"
        );
        scratch.write_user("plan.yml", VALID);
        let (code, out, _) = run_in(&scratch, Command::Show, "plan", true);
        assert_eq!(code, 0);
        assert!(!out.contains("scope") && !out.contains("skipped"), "{out}");
    }

    #[test]
    fn with_no_home_folder_a_missing_name_is_a_usage_error() {
        let scratch = Scratch::new("no-home");
        let (code, out, err) = run_with(&scratch, None, Command::Check, "ghost", false);
        assert_eq!((code, out.as_str()), (EXIT_USAGE_ERROR, ""));
        assert!(err.contains("No workflow named `ghost`"), "{err}");
    }
}
