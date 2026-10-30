// SPDX-License-Identifier: Apache-2.0
//
// flow.rs: `konductor flow check <name>` and `konductor flow show <name>`.
//
// The format, its checks and the JSON they print live in the `workflow-core` crate, which does no IO. The file
// source and lookup live in `workflow-adapters`. This module only wires them to the command line and decides the
// output and the exit code.
//
// Exit codes: 0 when the workflow has no errors, 64 for a usage error (a bad name, `library/<name>`, or a name that
// matches no file), 65 when the workflow has errors. Never 2, which the CLI reserves.
//
// A bare name is looked up in `<project>/.konductor/workflows/` and then in `~/.konductor/workflows/`. The project is
// the current directory, as for `init` and `config`. `library/<name>` names a shipped workflow, and none exist yet.

use std::io::Write;
use std::path::Path;

use workflow_adapters::Lookup;
use workflow_core::{check_text, parse_reference, Checked, Reference, ReferenceError};

use crate::cli::output::{self, status, ColorMode};
use crate::cli::FlowAction;

const EXIT_USAGE_ERROR: u8 = 64;
/// The workflow has errors. Same number as the CLI's other state or verification failures.
const EXIT_WORKFLOW_ERRORS: u8 = 65;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Command {
    Check,
    Show,
}

pub(crate) fn dispatch_flow(action: FlowAction, json: bool, color: ColorMode) -> u8 {
    let (command, name) = match action {
        FlowAction::Check { name } => (Command::Check, name),
        FlowAction::Show { name } => (Command::Show, name),
    };
    let cwd = match std::env::current_dir() {
        Ok(dir) => dir,
        Err(err) => {
            eprintln!(
                "{} could not determine the current directory: {err}",
                output::error_prefix(color, "konductor flow:")
            );
            return EXIT_USAGE_ERROR;
        }
    };
    let home = crate::cli::install::index::env_home_dir();
    run(
        command,
        &cwd,
        home.as_deref(),
        &name,
        json,
        color,
        &mut std::io::stdout(),
        &mut std::io::stderr(),
    )
}

/// Runs one `flow` command. The project root and the home folder are passed in, so tests can point at scratch folders.
#[allow(clippy::too_many_arguments)]
fn run(
    command: Command,
    project_root: &Path,
    home: Option<&Path>,
    name: &str,
    json: bool,
    color: ColorMode,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    let name = match parse_reference(name) {
        Ok(Reference::Local(name)) => name,
        Ok(Reference::Shipped(_)) => {
            let message =
                "Shipped workflows (`library/<name>`) arrive in a later step. None exist yet.";
            return usage_error(message, json, color, out, err);
        }
        Err(ReferenceError::InvalidName) => {
            let message = format!("A workflow name {}.", workflow_core::rules::NAME_RULE);
            return usage_error(&message, json, color, out, err);
        }
    };
    let Some(found) = Lookup::new(project_root, home).find(&name) else {
        let message = format!(
            "No workflow named `{name}`. Looked for `.konductor/workflows/{name}.yml` in this project and in your home \
             folder."
        );
        return usage_error(&message, json, color, out, err);
    };
    let checked = check_text(&name, &found.text, &found.source);
    let code = if checked.is_valid() {
        0
    } else {
        EXIT_WORKFLOW_ERRORS
    };
    match command {
        Command::Check => print_check(&checked, json, color, out),
        Command::Show => print_show(&checked, json, out, err),
    }
    code
}

fn usage_error(
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
        let _ = writeln!(
            err,
            "{} {message}",
            output::error_prefix(color, "konductor flow:")
        );
    }
    EXIT_USAGE_ERROR
}

fn print_check(checked: &Checked, json: bool, color: ColorMode, out: &mut dyn Write) {
    if json {
        let _ = writeln!(out, "{}", checked.report_json().compact());
        return;
    }
    if checked.is_valid() {
        let stages = checked.workflow.as_ref().map_or(0, |w| w.stages.len());
        let plural = if stages == 1 { "" } else { "s" };
        let _ = writeln!(
            out,
            "{} {} ({stages} stage{plural})",
            status::ok(color, "ok:"),
            checked.name
        );
        return;
    }
    write_diagnostics(checked, color, out);
}

fn print_show(checked: &Checked, json: bool, out: &mut dyn Write, err: &mut dyn Write) {
    match &checked.workflow {
        Some(workflow) => {
            let _ = writeln!(out, "{}", workflow.to_json().pretty());
        }
        // A workflow with errors has no resolved form. In `--json` mode the report goes to stdout, so a script reads
        // one stream. Otherwise it goes to stderr, and stdout stays empty rather than hold something that is not the
        // workflow.
        None if json => {
            let _ = writeln!(out, "{}", checked.report_json().compact());
        }
        // The color helpers follow the state of stdout, so a line for stderr is written plain.
        None => write_diagnostics(checked, ColorMode::disabled(), err),
    }
}

fn write_diagnostics(checked: &Checked, color: ColorMode, out: &mut dyn Write) {
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
    let _ = writeln!(out, "{}: {count} error{plural}", checked.name);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    const VALID: &str = "format: konductor/1\nversion: 0.1.0\nintent:\n  outcome: Do it.\nstages:\n  - name: plan\n    agent: k-architect\n";

    struct Scratch(PathBuf);

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
            Scratch(dir)
        }

        fn write(&self, name: &str, text: &str) {
            fs::write(self.0.join(".konductor/workflows").join(name), text).unwrap();
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn run_in(scratch: &Scratch, command: Command, name: &str, json: bool) -> (u8, String, String) {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = run(
            command,
            &scratch.0,
            None,
            name,
            json,
            ColorMode::disabled(),
            &mut out,
            &mut err,
        );
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
            (0, "ok: plan (1 stage)\n", "")
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
        assert!(out.ends_with("plan: 1 error\n"), "{out}");
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
        assert!(err.contains("arrive in a later step"), "{err}");
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
}
