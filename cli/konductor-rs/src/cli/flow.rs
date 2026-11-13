// SPDX-License-Identifier: Apache-2.0
//
// flow.rs: `konductor flow check <name>`, `konductor flow show <name>`, `konductor flow run <name>` and
// `konductor flow trust`.
//
// The format, its checks, the stage prompt, the runner and the JSON they print live in the `workflow-core` crate,
// which does no IO. The file source, lookup, run store, lock and the `fake` harness live in `workflow-adapters`. This
// module only wires them to the command line and decides the output and the exit code.
//
// Exit codes: 0 when the workflow has no errors (and, for `run`, the run passed), 1 when a run halted, 64 for a usage
// error (a bad name, `library/<name>`, a name that matches no file, or a bad `run` input), 65 when the workflow has
// errors, 74 when the trust record cannot be kept, or cannot be changed because it is damaged or newer (a record that
// cannot be read only trusts nothing), or when `flow run` or `flow trust` needs HOME and it is unset or not an absolute
// path, 75 when the workspace lock refuses the run, 77 when the workflow is not trusted and the user said no, there was
// no terminal, or a `--trust` hash did not match, or when the project root would be the home folder. Never 2, which
// the CLI reserves.
//
// A bare name is looked up in `<project>/.konductor/workflows/` and then in `~/.konductor/workflows/`. For `flow run`
// and `flow trust`, the project root is resolved by `find_project_root` (D-001): it walks upward from the current
// directory and stops at the git top folder (the folder that holds `.git`), and it refuses a root that is `$HOME`
// before it searches for `.konductor/`. `flow check` and `flow show` still use the current directory as in 1c.
// `library/<name>` names a shipped workflow, and none exist yet.
//
// Harness: `--harness` takes `kiro-cli`, `claude` or `fake`. Without it the one runner harness that the install index
// records is used (`flow_harness.rs` reads the index). A stage whose agent the harness cannot see is a usage error (exit
// 64) before the first stage and before the trust question.
//
// Interrupts: on Kiro CLI and on Claude Code, SIGINT, SIGTERM and SIGHUP end the running session's process group
// through the launcher and halt the run (`flow_interrupt.rs`). The command exits 1 like any halted run.
//
// Trust: a project workflow, and any workflow in a repository that has tool configuration files, runs only after
// the user confirmed its trust hash. The hash is made from the bytes the loader parsed (`workflow_core::trust`). The
// record is `~/.konductor/trust.json`.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use workflow_adapters::process::current_owner;
use workflow_adapters::{
    config_folders, resolve_harness, scan_repo_config, ClaudeHarness, FakeHarness,
    FileAgentCatalog, FileRunLock, FileRunStore, FileTrustStore, Found, HarnessChoice,
    InstalledFiles, KiroHarness, Located, Lookup, Scope, Script, SimulatedClock, Skip, Skipped,
    StdTerminal, SystemLauncher, FAKE_SCRIPT_ENV, NO_TIMEOUT_WARNING,
};
use workflow_core::json::Json;
use workflow_core::model::Workflow;
use workflow_core::ports::{
    AgentCatalog, Harness, ProcessGroup, RunLock, Runner, Terminal, TrustStore,
};
use workflow_core::run::{Run, RunStatus, StageState, StageStatus};
use workflow_core::runner::{execute, prepare, start, GuardedHarness, StartError, SweepResult};
use workflow_core::time::format_timestamp;
use workflow_core::trust::{
    ambiguous_agents, decide, needs_trust, render_summary, AmbiguousAgent, ConfigFile,
    SummaryInput, TrustInputs, UnreadableConfig, Verdict,
};
use workflow_core::{check_text, parse_reference, Checked, Reference, ReferenceError};

use crate::cli::flow_harness::{check_claude_agents, check_kiro_agents, installed_runners};
use crate::cli::flow_interrupt;
use crate::cli::output::{self, status, ColorMode};
use crate::cli::FlowAction;

/// A run halted: a stage was blocked. Also any failure while a run is under way, such as a state file that cannot be
/// written, which is the CLI's "halted (runtime error)".
const EXIT_HALTED: u8 = 1;
const EXIT_USAGE_ERROR: u8 = 64;
/// The trust record cannot be kept (`EX_IOERR`): no home folder, or a file error. Not 1, which is "a run halted".
const EXIT_RECORD: u8 = 74;
/// The workflow has errors. Same number as the CLI's other state or verification failures.
const EXIT_WORKFLOW_ERRORS: u8 = 65;
/// The workspace lock refuses the run (`EX_TEMPFAIL`): another process holds it. The `--json` envelope's `code` says
/// whether its run is known.
const EXIT_ALREADY_RUNNING: u8 = 75;
/// `flow run` needs `$HOME` to refuse a project root that is the home folder, and it is unset or not absolute
/// (`EX_IOERR`).
const EXIT_HOME_UNUSABLE: u8 = 74;
/// The project root would be the home folder. Not a trust question, but the spec gives it the trust refusal code, so a
/// script handles one code (D25).
const EXIT_ROOT_IS_HOME: u8 = 77;
/// The workflow is not trusted: the user said no, there was no terminal to ask, or a `--trust` hash did not match.
const EXIT_NOT_TRUSTED: u8 = 77;
/// The environment variable that holds a trust hash, in place of `--trust`.
const TRUST_ENV: &str = "KONDUCTOR_TRUST";
/// How many characters of the trust hash the user types to confirm.
const CODE_LENGTH: usize = 8;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Command {
    Check,
    Show,
}

/// What one run of a `flow` command needs besides the name. The folders are passed in so tests can point at scratch
/// ones.
struct Context<'a> {
    /// The current directory. The tool configuration is searched from here up to the git root, because a harness
    /// started by the run loads what is in the folders on that path.
    cwd: &'a Path,
    /// The folder with `.konductor/`, where workflows, runs and the install manifest are kept.
    project_root: &'a Path,
    home: Option<&'a Path>,
    json: bool,
    color: ColorMode,
}

/// The inputs of `flow run` besides the name.
struct RunArgs {
    goal: Option<String>,
    /// `--harness`. Without it the install index picks the runner harness.
    harness: Option<String>,
    fake_script: Option<PathBuf>,
    /// The value of `KONDUCTOR_FAKE_SCRIPT`.
    fake_script_env: Option<OsString>,
    /// The hash from `--trust`, or else from `KONDUCTOR_TRUST`.
    trust: Option<String>,
}

/// The record and the person that the trust gate talks to.
struct TrustPorts<'a> {
    store: &'a mut dyn TrustStore,
    terminal: &'a mut dyn Terminal,
}

/// `cwd` is the current directory. The caller resolves it through the shared helper, so a failure to find it is
/// reported the way it is for the other commands, with telemetry and the command-agnostic `--json` envelope.
///
/// `flow run` resolves its project root with [`find_project_root`] (D-001). `flow check` and `flow show` keep using
/// `cwd` directly for now; widening them to the upward search is a follow-up.
pub(crate) fn dispatch_flow(action: FlowAction, cwd: &Path, json: bool, color: ColorMode) -> u8 {
    // A relative HOME would put the trust record, and the "user" workflows, in the current folder, which can be the
    // repository. It counts as no home folder.
    let home = crate::cli::install::index::env_home_dir().filter(|h| h.is_absolute());
    let (out, err) = (&mut std::io::stdout(), &mut std::io::stderr());
    match action {
        FlowAction::Check { name } => {
            let context = Context {
                cwd,
                project_root: cwd,
                home: home.as_deref(),
                json,
                color,
            };
            run(Command::Check, &context, &name, out, err)
        }
        FlowAction::Show { name } => {
            let context = Context {
                cwd,
                project_root: cwd,
                home: home.as_deref(),
                json,
                color,
            };
            run(Command::Show, &context, &name, out, err)
        }
        FlowAction::Run {
            name,
            goal,
            harness,
            fake_script,
            trust,
        } => {
            let project_root = match find_project_root(cwd, home.as_deref()) {
                Ok(root) => root,
                Err(error) => return report_root_error(error, json, color, out, err),
            };
            let context = Context {
                cwd,
                project_root: &project_root,
                home: home.as_deref(),
                json,
                color,
            };
            let args = RunArgs {
                goal,
                harness,
                fake_script,
                fake_script_env: std::env::var_os(FAKE_SCRIPT_ENV),
                trust: trust.or_else(|| {
                    std::env::var(TRUST_ENV)
                        .ok()
                        .filter(|value| !value.is_empty())
                }),
            };
            let mut ports = TrustPorts {
                store: &mut FileTrustStore::new(context.home),
                terminal: &mut StdTerminal,
            };
            run_workflow(&context, &name, &args, &mut ports, out, err)
        }
        FlowAction::Trust { name, yes, revoke } => {
            // The record is keyed by the repository root, so `flow trust` finds the root the way `flow run` does,
            // including the refusal of a root that is the home folder: no record is kept for it.
            let project_root = match find_project_root(cwd, home.as_deref()) {
                Ok(root) => root,
                Err(error) => return report_root_error(error, json, color, out, err),
            };
            let context = Context {
                cwd,
                project_root: &project_root,
                home: home.as_deref(),
                json,
                color,
            };
            let mut ports = TrustPorts {
                store: &mut FileTrustStore::new(context.home),
                terminal: &mut StdTerminal,
            };
            match (name, revoke) {
                (_, Some(revoked)) => revoke_trust(&context, &revoked, ports.store, out, err),
                (Some(name), None) => trust_workflow(&context, &name, yes, &mut ports, out, err),
                (None, None) => {
                    usage_error("`flow trust` needs a workflow name.", &context, out, err)
                }
            }
        }
    }
}

/// Why `flow run` has no project root.
#[derive(Debug, PartialEq, Eq)]
enum RootError {
    /// `$HOME` is unset, empty or not an absolute path, so it cannot be compared with the root (exit 74).
    HomeUnusable,
    /// The git top folder, or a working folder with no git folder, is `$HOME` (exit 77).
    IsHome,
    /// There is a git folder but no `.konductor/` at or below its top (exit 64).
    NoKonductor,
}

/// True when `a` and `b` are the same folder. Equal paths are the same without touching the disk. Otherwise both are
/// canonicalized (symlinks resolved), so a `$HOME` that is a link to the folder still matches. Canonicalizing reads
/// the path itself, never what is inside it. A path that cannot be canonicalized only matches when equal.
fn same_folder(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Resolves the project root for `flow run`, per D-001 and D25. `home` is the value of `$HOME`, passed in so tests
/// never read the environment.
///
/// 1. `home` unset or not absolute: `HomeUnusable`.
/// 2. Find the git top folder (the folder that holds `.git`) by walking up from `start`. If it is `home`, or if there
///    is no git folder and `start` is `home`, the answer is `IsHome`. This is decided before any search for
///    `.konductor/`, and nothing inside `home` is listed or read. The walk only asks whether `.git` exists.
/// 3. With a git top folder, the first folder from `start` up to it that has `.konductor/` is the root. None:
///    `NoKonductor`.
/// 4. With no git folder, `start` is the root.
///
/// `.git` can be a regular file in a git worktree, so the check only asks whether it exists.
fn find_project_root(start: &Path, home: Option<&Path>) -> Result<PathBuf, RootError> {
    let home = match home {
        Some(home) if home.is_absolute() => home,
        _ => return Err(RootError::HomeUnusable),
    };
    // The git top folder bounds the upward search. Without one, no upward search.
    let git_top = {
        let mut cur = start;
        loop {
            if cur.join(".git").exists() {
                break Some(cur.to_path_buf());
            }
            match cur.parent() {
                Some(parent) => cur = parent,
                None => break None,
            }
        }
    };
    let Some(git_top) = git_top else {
        if same_folder(start, home) {
            return Err(RootError::IsHome);
        }
        return Ok(start.to_path_buf());
    };
    if same_folder(&git_top, home) {
        return Err(RootError::IsHome);
    }
    // The first ancestor at or below the git top folder that has `.konductor/` wins.
    let mut cur = start.to_path_buf();
    loop {
        if cur.join(".konductor").is_dir() {
            return Ok(cur);
        }
        if cur == git_top {
            break;
        }
        match cur.parent() {
            Some(parent) => cur = parent.to_path_buf(),
            None => break,
        }
    }
    Err(RootError::NoKonductor)
}

/// Reports a root that could not be resolved: 74, 77 or the usage error 64. Under `--json` the first two carry a
/// `code`.
fn report_root_error(
    error: RootError,
    json: bool,
    color: ColorMode,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    let (exit, code, message) = match error {
        RootError::NoKonductor => {
            return report_usage_error(
                "no .konductor/ found, run konductor init",
                json,
                color,
                out,
                err,
            )
        }
        RootError::HomeUnusable => (
            EXIT_HOME_UNUSABLE,
            "home_unusable",
            "HOME is not set to an absolute path. `flow run` needs it to refuse a project root that is the home folder.",
        ),
        RootError::IsHome => (
            EXIT_ROOT_IS_HOME,
            "project_root_is_home",
            "The project root would be your home folder. Run `flow run` inside a project folder instead.",
        ),
    };
    if json {
        let envelope = crate::cli::report::build_error_json(
            "flow",
            message,
            vec![("code", serde_json::Value::from(code))],
        );
        let _ = writeln!(out, "{envelope}");
    } else {
        let prefix = output::error_prefix(color, "konductor flow:");
        let _ = writeln!(err, "{prefix} {message}");
    }
    exit
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
        Command::Check => {
            let assessment = assess(context, &checked, &found, &agent_catalog(context));
            print_check(
                &checked,
                &found.scope,
                &skipped,
                (assessment.hash.as_deref(), &assessment.unreadable),
                context,
                out,
            );
        }
        Command::Show => print_show(&checked, found.scope, &skipped, context.json, out, err),
    }
    code
}

/// Runs `flow run`. The checks that can refuse the run come first, and nothing is written until they pass: the name,
/// the harness, the workflow, the goal and the prompts, the fake script, and then trust. The run uses the workflow that
/// was checked and hashed here, so a file edited after the confirmation does not run.
fn run_workflow(
    context: &Context,
    name: &str,
    args: &RunArgs,
    ports: &mut TrustPorts,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    // The install index is read here and the engine gets the answer: which runner harnesses are installed.
    let choice = match resolve_harness(
        args.harness.as_deref(),
        installed_runners(context.home),
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
    // Kiro CLI starts in the project root and finds an agent there, then in the home folder, and nowhere else. This one
    // catalog checks the agents, builds the trust summary and the ambiguity check, and is the one the harness runs
    // from, so the file the user is shown is the file that runs.
    let kiro_catalog = FileAgentCatalog::new(context.project_root, context.home);
    let claude_catalog = claude_catalog(context);
    let script = match &choice {
        HarnessChoice::Fake { script } => match Script::load(script) {
            Ok(script) => Some(script),
            Err(why) => {
                let message = format!("The fake script cannot be used: {why}.");
                return usage_error(&message, context, out, err);
            }
        },
        // A stage whose agent the harness cannot see fails before the first stage, and before the trust question: the
        // user has to change the install or the folder, so nothing is shown that cannot run.
        HarnessChoice::KiroCli | HarnessChoice::Claude => {
            // A session starts in the project root, which a path that is not UTF-8 cannot be given to the launcher as.
            if context.project_root.to_str().is_none() {
                return usage_error(
                    "The project root is not valid UTF-8, so a session cannot start in it.",
                    context,
                    out,
                    err,
                );
            }
            let stages = &prepared.workflow.stages;
            let visible = if choice == HarnessChoice::Claude {
                check_claude_agents(stages, &claude_catalog, context.project_root, context.home)
            } else {
                check_kiro_agents(stages, &kiro_catalog, context.project_root, context.home)
            };
            if let Err(message) = visible {
                return usage_error(&message, context, out, err);
            }
            None
        }
    };

    let catalog = match &choice {
        HarnessChoice::Fake { .. } => agent_catalog(context),
        HarnessChoice::KiroCli => kiro_catalog.clone(),
        HarnessChoice::Claude => claude_catalog.clone(),
    };
    let mut assessment = assess(context, &checked, &found, &catalog);
    if choice == HarnessChoice::Claude {
        add_claude_mismatches(&mut assessment, &checked, &claude_catalog, context);
    }
    let subject = Subject {
        name: &name,
        checked: &checked,
        found: &found,
        assessment: &assessment,
    };
    if let Err(code) = gate(context, &subject, args.trust.as_deref(), ports, out, err) {
        return code;
    }

    let mut store = match FileRunStore::open(context.project_root) {
        Ok(store) => store,
        Err(error) => return runtime_error(&error.0, context, out, err),
    };
    let mut lock = FileRunLock::new(context.project_root);
    let owner = current_owner();
    let clock = Rc::new(SimulatedClock::default());
    // From here on a Ctrl-C, SIGTERM or SIGHUP does not end this process by itself on a real harness: it ends the session's
    // group through the launcher and halts the run. The fake harness starts no process, so it keeps the default.
    let interrupt = Arc::new(AtomicBool::new(false));
    if matches!(choice, HarnessChoice::KiroCli | HarnessChoice::Claude) {
        if let Err(error) = flow_interrupt::watch(&interrupt) {
            let message =
                format!("Interrupts cannot be handled, so the run was not started: {error}");
            return runtime_error(&message, context, out, err);
        }
    }
    let mut launcher = SystemLauncher::new().with_interrupt(Arc::clone(&interrupt));
    // Without `timeout` the stage limit lasts only while this process does. One line says so before the first session.
    if matches!(choice, HarnessChoice::KiroCli) && !launcher.guards_limit() {
        let _ = writeln!(err, "warning: {NO_TIMEOUT_WARNING}");
    }
    let started = match start(
        &prepared,
        choice.name(),
        owner,
        &mut store,
        &mut lock,
        &*clock,
        &mut launcher,
    ) {
        Ok(started) => started,
        Err(error) => return refused(&error, &lock, context, out, err),
    };
    for swept in &started.swept {
        match &swept.result {
            SweepResult::Ended if !context.json => {
                let _ = writeln!(
                    err,
                    "note: Run {} left a session running in process group {}{}. It was ended.",
                    swept.run_id,
                    swept.group.pgid,
                    deadline_note(&swept.group)
                );
            }
            // Shown under `--json` too, since a session may still be running.
            SweepResult::Failed(why) => {
                let _ = writeln!(
                    err,
                    "warning: Run {} left a session running in process group {}{}, and it could not be ended: {why}",
                    swept.run_id,
                    swept.group.pgid,
                    deadline_note(&swept.group)
                );
            }
            _ => {}
        }
    }
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
    // Shown under `--json` too, since stdout carries only the run state and the run is still marked `running`.
    for stuck in &started.unrecovered {
        let _ = writeln!(
            err,
            "warning: Run {} was left running by a process that is gone, but it could not be ended, so it still reads \
             as running: {}",
            stuck.run_id, stuck.error.0
        );
    }
    let mut run = started.run;
    let mut inner: Box<dyn Harness + '_> = match script {
        Some(script) => Box::new(FakeHarness::new(script, Rc::clone(&clock))),
        None => {
            // Checked above, so nothing is replaced.
            let cwd = context.project_root.to_string_lossy();
            let prefix = output::error_prefix(context.color, "konductor flow:");
            // One line on standard error when a session does not end well. It is not part of the run state.
            let note = Box::new(move |line: &str| {
                let _ = writeln!(std::io::stderr(), "{prefix} {line}");
            });
            match &choice {
                HarnessChoice::Claude => Box::new(ClaudeHarness::new(
                    &mut launcher,
                    &claude_catalog,
                    "claude",
                    &cwd,
                    note,
                )),
                _ => Box::new(KiroHarness::new(
                    &mut launcher,
                    &kiro_catalog,
                    "kiro-cli",
                    &cwd,
                    note,
                )),
            }
        }
    };
    // The confirmation covers what was on disk when it was given. The runner reads the tool configuration files again
    // before each session, so an edit made while the summary was on screen, or by an earlier stage, does not run under
    // the old confirmation. A file that can no longer be read in full counts as a change. The gate has refused a run
    // with no hash, so the empty fallback is never reached, and it would match nothing.
    let confirmed = assessment.hash.clone().unwrap_or_default();
    let unchanged = || {
        config_unchanged(
            context,
            &assessment.installed,
            &checked.trust_inputs,
            &assessment.config,
            &confirmed,
        )
    };
    let mut harness = GuardedHarness::new(&mut *inner, &unchanged);
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
    if let Some(stage) = harness.refused_stage().map(str::to_string) {
        let prefix = output::error_prefix(context.color, "konductor flow:");
        let found = harness.refused_cause().unwrap_or_default();
        let message = halt_message(assessment.needed, &stage, found, &name);
        let _ = writeln!(err, "{prefix} {message}");
    }
    if let Err(error) = executed {
        return runtime_error(&error.0, context, out, err);
    }
    print_run(&run, context, out);
    match run.status {
        RunStatus::Passed => 0,
        _ => EXIT_HALTED,
    }
}

/// ` (its time limit ends at 2026-11-05T12:30:00Z)` for a group recorded with a deadline, and nothing for an older one.
fn deadline_note(group: &ProcessGroup) -> String {
    group.deadline_ms.map_or_else(String::new, |ms| {
        format!(" (its time limit ends at {})", format_timestamp(ms))
    })
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
    // A run on the fake harness ran no agent, so its last line must not read like a real run.
    let note = if run.harness == "fake" {
        " (harness: fake, no agent ran)"
    } else {
        ""
    };
    let _ = writeln!(out, "run {}: {label}{note}", run.run_id);
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

/// A failure to keep or find the trust record, exit 74. Nothing ran.
fn record_error(message: &str, context: &Context, out: &mut dyn Write, err: &mut dyn Write) -> u8 {
    runtime_error(message, context, out, err);
    EXIT_RECORD
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
    trust: (Option<&str>, &[UnreadableConfig]),
    context: &Context,
    out: &mut dyn Write,
) {
    // The hash, or, when the tool configuration cannot be read in full, each entry that stops it.
    let (trust_hash, unreadable) = trust;
    let scope = *scope;
    if context.json {
        let mut report = report_with_provenance(checked, scope, skipped);
        // A repo whose tool configuration cannot be read in full has no hash, so the field is left out.
        if let Some(hash) = trust_hash {
            report.insert("trust_hash", Json::str(hash));
        }
        if !unreadable.is_empty() {
            let entries = unreadable
                .iter()
                .map(|entry| {
                    let mut item = Json::object();
                    item.insert("path", Json::str(&entry.path));
                    item.insert("reason", Json::str(&entry.reason));
                    item
                })
                .collect();
            report.insert("unreadable_config", Json::Array(entries));
        }
        let _ = writeln!(out, "{}", report.compact());
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
        match trust_hash {
            Some(hash) => {
                let _ = writeln!(out, "trust hash: {hash}");
            }
            None => {
                let listed: Vec<String> = unreadable
                    .iter()
                    .map(|entry| cause(&entry.path, &entry.reason))
                    .collect();
                let _ = writeln!(
                    out,
                    "trust hash: none, because the tool configuration of this repository cannot be read in full: {}",
                    listed.join("; ")
                );
            }
        }
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

// ---------------------------------------------------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------------------------------------------------

/// What the trust rules make of one workflow in this repository.
struct Assessment {
    /// The trust hash: the workflow and its prompt files as parsed, and the repo tool configuration files. `None` while
    /// an entry of the tool configuration cannot be read in full: such an entry has no hash, and the run is refused.
    hash: Option<String>,
    config: Vec<ConfigFile>,
    /// The files the install manifest vouched for at this point. Every later scan of the run uses this set.
    installed: InstalledFiles,
    /// The config entries the scan could not read. While there is one, nothing can be trusted: a change behind it
    /// would not show in a hash.
    unreadable: Vec<UnreadableConfig>,
    /// Whether running the workflow needs the user's confirmation.
    needed: bool,
    /// The agents of the workflow whose id does not lead to one definition. The harness may use a file the summary
    /// would not describe, so the run and the trust record are refused. The trust hash is still made.
    ambiguous_agents: Vec<AmbiguousAgent>,
    /// The catalog that the ambiguity check and the summary read: the one the chosen harness runs from.
    catalog: FileAgentCatalog,
}

/// The repo tool configuration files as they are now, or every entry that cannot be read in full.
///
/// `installed` is what the install manifest vouched for when the run was assessed. It is not read again, so a stage
/// that edits the manifest cannot hide a file it adds.
fn scan_config(
    context: &Context,
    installed: &InstalledFiles,
) -> Result<Vec<ConfigFile>, Vec<UnreadableConfig>> {
    scan_repo_config(context.cwd, context.home, context.project_root, installed)
}

/// A path and what is wrong with it, for a message. Both come from the files of the repo, so they are made printable.
fn cause(path: &str, what: &str) -> String {
    format!(
        "`{}` {}",
        workflow_core::trust::plain(path),
        workflow_core::trust::plain(what)
    )
}

/// The first path, in path order, that is not the same in `after` as it was in `before`, and how it differs.
fn first_difference(before: &[ConfigFile], after: &[ConfigFile]) -> String {
    let mut changes: Vec<(&str, &str)> = Vec::new();
    for file in after {
        match before.iter().find(|b| b.path == file.path) {
            None => changes.push((&file.path, "was added")),
            Some(old) if old.bytes != file.bytes => changes.push((&file.path, "was edited")),
            Some(_) => {}
        }
    }
    for file in before {
        if !after.iter().any(|a| a.path == file.path) {
            changes.push((&file.path, "was removed"));
        }
    }
    changes.sort();
    match changes.first() {
        Some((path, what)) => cause(path, what),
        None => "the files no longer match what was confirmed".to_string(),
    }
}

/// The check before each session: `Ok` while the tool configuration files are as they were confirmed, and otherwise
/// the first path that differs or cannot be read, with the reason. `installed` is the set of files the manifest
/// vouched for when the run was assessed, so the files counted now are counted by the same rule as then.
fn config_unchanged(
    context: &Context,
    installed: &InstalledFiles,
    inputs: &TrustInputs,
    confirmed_files: &[ConfigFile],
    confirmed_hash: &str,
) -> Result<(), String> {
    match scan_config(context, installed) {
        Err(unreadable) => Err(unreadable.first().map_or_else(
            || "a tool configuration file cannot be read".to_string(),
            |entry| cause(&entry.path, &entry.reason),
        )),
        Ok(files) if inputs.hash(&files) == confirmed_hash => Ok(()),
        Ok(files) => Err(first_difference(confirmed_files, &files)),
    }
}

/// What the user is told when the check refused the session of `stage`. When the run needed no confirmation, nothing
/// was confirmed, so the change is dated from the start of the run.
fn halt_message(needed: bool, stage: &str, found: &str, name: &str) -> String {
    let since = if needed {
        "after the workflow was confirmed"
    } else {
        "since the run started"
    };
    format!(
        "The tool configuration files of this repository changed {since}: {found}. Stage `{stage}` did not start. \
         Review the files and run `konductor flow trust {name}`, then run it again."
    )
}

/// The agent catalog of the fake harness and of `flow check`: the working folder, the folders above it up to the git
/// root, then the home folder. Kiro CLI does not search that way, so a run on it uses a catalog of its own.
fn agent_catalog(context: &Context) -> FileAgentCatalog {
    let folders = config_folders(context.cwd, context.home);
    FileAgentCatalog::new(context.cwd, context.home)
        .with_folders_above(folders.get(1..).unwrap_or_default())
}

/// The catalog of a run on Claude Code, which starts its session in the project root: the project root, the folders
/// above it up to the git top folder (the nearest definition wins), then the home folder.
fn claude_catalog(context: &Context) -> FileAgentCatalog {
    FileAgentCatalog::new(context.project_root, context.home).with_folders_above(
        config_folders(context.project_root, context.home)
            .get(1..)
            .unwrap_or_default(),
    )
}

/// Marks as ambiguous each agent of the workflow for which the search from the working folder and the search Claude
/// Code makes from the project root find different definitions, so the file the user confirms is the file that runs.
/// Run from the project root the two are the same search and nothing is added.
fn add_claude_mismatches(
    assessment: &mut Assessment,
    checked: &Checked,
    claude: &FileAgentCatalog,
    context: &Context,
) {
    let Some(workflow) = checked.workflow.as_ref() else {
        return;
    };
    let from_cwd = agent_catalog(context);
    assessment
        .ambiguous_agents
        .extend(claude_mismatches(workflow, claude, &from_cwd));
}

fn claude_mismatches(
    workflow: &Workflow,
    claude: &FileAgentCatalog,
    from_cwd: &FileAgentCatalog,
) -> Vec<AmbiguousAgent> {
    let pick = |catalog: &FileAgentCatalog, agent: &str| {
        catalog
            .definitions(agent)
            .into_iter()
            .find(|d| d.runner == Runner::Claude)
    };
    let mut found: Vec<AmbiguousAgent> = Vec::new();
    for stage in &workflow.stages {
        if found.iter().any(|a| a.agent == stage.agent) {
            continue;
        }
        if pick(claude, &stage.agent) != pick(from_cwd, &stage.agent) {
            found.push(AmbiguousAgent {
                agent: stage.agent.clone(),
                reason: "the search from the current folder and the search that Claude Code makes from the project \
                         root find different files, so what you would confirm may not be what runs. Run it from the \
                         project root, or remove the extra file"
                    .to_string(),
            });
        }
    }
    found
}

/// The catalog for `flow trust`, which has no `--harness`: the one a `flow run` without it would use. When that is not
/// known, the wider search of the other harnesses, which shows more files and never fewer.
fn trust_catalog(context: &Context) -> FileAgentCatalog {
    match resolve_harness(None, installed_runners(context.home), None, None) {
        Ok(HarnessChoice::KiroCli) => FileAgentCatalog::new(context.project_root, context.home),
        Ok(HarnessChoice::Claude) => claude_catalog(context),
        _ => agent_catalog(context),
    }
}

fn assess(
    context: &Context,
    checked: &Checked,
    found: &Found,
    catalog: &FileAgentCatalog,
) -> Assessment {
    let ambiguous_agents = checked
        .workflow
        .as_ref()
        .map(|workflow| ambiguous_agents(workflow, catalog))
        .unwrap_or_default();
    let installed = installed_files(context.project_root, context.home);
    match scan_config(context, &installed) {
        Ok(config) => Assessment {
            hash: Some(checked.trust_inputs.hash(&config)),
            needed: needs_trust(found.scope == Scope::Project, &config),
            unreadable: Vec::new(),
            config,
            installed,
            ambiguous_agents,
            catalog: catalog.clone(),
        },
        // Nothing can be hashed, and the repo has tool configuration, so the gate must refuse.
        Err(unreadable) => Assessment {
            hash: None,
            needed: true,
            unreadable,
            config: Vec::new(),
            installed,
            ambiguous_agents,
            catalog: catalog.clone(),
        },
    }
}

/// The files that a project install of Konductor wrote here and that still have the hash it gave them, so they are not
/// counted as tool configuration of the repo.
///
/// A manifest lives inside the repo, so a clone could ship one that vouches for its own files. It counts only when the
/// install index in the user's home, which no clone can write, lists this folder as a finished install target. The
/// manifest also needs a finished status, and each file a recorded hash. Anything else leaves every file counted, so a
/// failure here asks more often and never less.
///
/// What this returns is what the manifest vouches for. The scan then honours it only for a file that cannot carry a
/// hook, an MCP server, a permission mode or a tool grant (see `workflow_adapters::scan_repo_config`), so settings,
/// MCP, hook and Kiro agent files and markdown with such front matter are hashed whatever the manifest says. That
/// holds until the home index keeps a hash for each file. The run and the check before each stage use this one set.
fn installed_files(project_root: &Path, home: Option<&Path>) -> InstalledFiles {
    use crate::cli::install::index::{read_index_at_home, IndexEntryStatus};
    use crate::cli::install::manifest::{read_manifest, Status};

    let mut installed = InstalledFiles::new();
    let Some(home) = home else { return installed };
    let Ok(canonical) = std::fs::canonicalize(project_root) else {
        return installed;
    };
    let Some(canonical) = canonical.to_str() else {
        return installed;
    };
    let Ok(Some(index)) = read_index_at_home(Some(home)) else {
        return installed;
    };
    let listed = index
        .installs
        .iter()
        .any(|e| e.target_dir == canonical && e.status == IndexEntryStatus::Complete);
    if !listed {
        return installed;
    }
    let Ok(Some(manifest)) = read_manifest(project_root) else {
        return installed;
    };
    for slot in manifest
        .strategies
        .iter()
        .filter(|s| s.status == Status::Complete)
    {
        let destination = slot.destination.trim_end_matches('/');
        for file in &slot.files {
            let Some(sha256) = &file.sha256 else { continue };
            let path = match destination {
                "." | "" => file.path.clone(),
                dir => format!("{dir}/{}", file.path),
            };
            // A path that leaves the repo is not an install of a file in it.
            if path.starts_with('/') || path.split('/').any(|part| part == "..") {
                continue;
            }
            installed.insert((path, sha256.to_ascii_lowercase()));
        }
    }
    installed
}

/// The workflow file as the user thinks of it.
fn display_path(name: &str, scope: Scope) -> String {
    match scope {
        Scope::Project => format!(".konductor/workflows/{name}.yml"),
        Scope::User => format!("~/.konductor/workflows/{name}.yml"),
    }
}

fn summary_text(subject: &Subject) -> Option<String> {
    let Subject {
        name,
        checked,
        found,
        assessment,
    } = *subject;
    let workflow = checked.workflow.as_ref()?;
    Some(render_summary(&SummaryInput {
        name,
        path: &display_path(name, found.scope),
        hash: assessment.hash.as_deref()?,
        workflow,
        inputs: &checked.trust_inputs,
        config: &assessment.config,
        catalog: &assessment.catalog,
    }))
}

/// The record's key for this repository: its canonical git root, the same root the config scan uses (a git root equal
/// to the home folder does not count). With no git root it is the current directory. A run from a subfolder and a run
/// from the root share one record.
fn repo_key(context: &Context) -> Result<String, String> {
    // `config_folders` ends with the outermost folder searched: the git root, or the project root when there is none.
    let folders = config_folders(context.cwd, context.home);
    let outermost = folders.last().map_or(context.cwd, PathBuf::as_path);
    let root = std::fs::canonicalize(outermost)
        .map_err(|e| format!("The repository root cannot be resolved: {e}."))?;
    root.to_str().map(str::to_string).ok_or_else(|| {
        "The repository root is not valid UTF-8, so it cannot key a trust record.".to_string()
    })
}

/// A trust refusal (exit 77). Under `--json` it is the error envelope with the code `trust_required`.
fn not_trusted(
    message: &str,
    hash: &str,
    context: &Context,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    refusal("trust_required", message, Some(hash), context, out, err)
}

/// A trust refusal with the `code` that tells a script why.
fn refusal(
    code: &str,
    message: &str,
    hash: Option<&str>,
    context: &Context,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    if context.json {
        let mut extra = vec![("code", serde_json::Value::from(code))];
        // A refusal for an unreadable tool configuration has no hash to give.
        if let Some(hash) = hash {
            extra.push(("trust_hash", serde_json::Value::from(hash)));
        }
        let envelope = crate::cli::report::build_error_json("flow", message, extra);
        let _ = writeln!(out, "{envelope}");
    } else {
        let prefix = output::error_prefix(context.color, "konductor flow:");
        let _ = writeln!(err, "{prefix} {message}");
    }
    EXIT_NOT_TRUSTED
}

/// The refusal when the scan of the tool configuration could not read something. It holds for `--trust` and `--yes`
/// too: such an entry has no hash, and a change behind it would not show in one.
fn refuse_unreadable_config(
    name: &str,
    assessment: &Assessment,
    context: &Context,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    let mut listed = String::new();
    for entry in &assessment.unreadable {
        listed.push_str(&format!(
            " {} {};",
            workflow_core::trust::plain(&entry.path),
            workflow_core::trust::plain(&entry.reason)
        ));
    }
    let message = format!(
        "The workflow `{name}` was not run, and cannot be trusted: the tool configuration of this repository cannot be \
         read in full, so a change behind it would not show in the trust hash.{listed} Remove the link, reduce the \
         folder or make the file readable, then try again. `--trust` and `--yes` do not override this."
    );
    refusal("tool_config_unreadable", &message, None, context, out, err)
}

/// The refusal when an agent id of the workflow does not lead to one definition. It holds for `--trust` and `--yes`
/// too, because the harness may run a file that nothing here described.
fn refuse_ambiguous_agent(
    name: &str,
    assessment: &Assessment,
    context: &Context,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    let mut listed = String::new();
    for entry in &assessment.ambiguous_agents {
        listed.push_str(&format!(
            " Agent `{}`: {}.",
            workflow_core::trust::plain(&entry.agent),
            workflow_core::trust::plain(&entry.reason)
        ));
    }
    let message = format!(
        "The workflow `{name}` was not run, and cannot be trusted: an agent it names cannot be matched to one file.\
         {listed} Give the agent one file whose `name` is the agent id and whose file name is `<id>.md`, then try \
         again. `--trust` and `--yes` do not override this."
    );
    refusal("tool_config_unreadable", &message, None, context, out, err)
}

/// The workflow that the trust rules are about, as it was checked and hashed.
struct Subject<'a> {
    name: &'a str,
    checked: &'a Checked,
    found: &'a Found,
    assessment: &'a Assessment,
}

/// The trust gate of `flow run`: lets the run go on, or gives the exit code that ends it.
fn gate(
    context: &Context,
    subject: &Subject,
    offered: Option<&str>,
    ports: &mut TrustPorts,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> Result<(), u8> {
    let Subject {
        name, assessment, ..
    } = *subject;
    // An entry the scan could not read has no hash. It refuses the run before anything else is asked, whatever `--trust`
    // says, and whether or not the workflow would need confirmation.
    let Some(hash) = assessment.hash.as_deref() else {
        return Err(refuse_unreadable_config(
            name, assessment, context, out, err,
        ));
    };
    if !assessment.ambiguous_agents.is_empty() {
        return Err(refuse_ambiguous_agent(name, assessment, context, out, err));
    }
    if !assessment.needed {
        return Ok(());
    }
    let key = match repo_key(context) {
        Ok(key) => key,
        Err(message) => return Err(record_error(&message, context, out, err)),
    };
    let recorded = ports.store.recorded(&key, name);
    match decide(hash, recorded.as_deref(), offered) {
        Verdict::Trusted | Verdict::OfferedHashMatches => Ok(()),
        Verdict::OfferedHashDiffers(given) => {
            let message = format!(
                "The trust hash you gave does not match the workflow `{name}`, so nothing ran. You gave {}. The \
                 workflow has {hash}.",
                workflow_core::trust::plain(&given)
            );
            Err(not_trusted(&message, hash, context, out, err))
        }
        Verdict::Unconfirmed if !ports.terminal.is_available() => {
            let why = if assessment.config.is_empty() {
                String::new()
            } else {
                " This repository has tool configuration files that a headless run loads, so every workflow in it \
                 needs this."
                    .to_string()
            };
            let message = format!(
                "The workflow `{name}` is not trusted, and there is no terminal to ask, so nothing ran.{why} Review \
                 it and the files it lists with `konductor flow trust {name}` in a terminal. To run it once without \
                 a terminal, pass `--trust <hash>` (or set {TRUST_ENV}=<hash>) with the hash of the version you \
                 reviewed. Do not take the hash from a file in the repository, such as `.envrc`, or work it out in the \
                 script that runs the workflow, because then nobody has reviewed what it covers."
            );
            Err(not_trusted(&message, hash, context, out, err))
        }
        Verdict::Unconfirmed => {
            // Fail before the question, so a yes is never followed by a failure to keep it.
            if let Err(error) = ports.store.can_record() {
                return Err(record_error(&error.0, context, out, err));
            }
            let Some(summary) = summary_text(subject) else {
                return Err(runtime_error(
                    "The workflow cannot be summarised.",
                    context,
                    out,
                    err,
                ));
            };
            if !confirmed(ports, &summary, hash) {
                let message = format!("The workflow `{name}` was not trusted, so nothing ran.");
                return Err(not_trusted(&message, hash, context, out, err));
            }
            ports
                .store
                .record(&key, name, hash)
                .map_err(|error| record_error(&error.0, context, out, err))
        }
    }
}

/// Shows the summary and asks the user to type the first characters of `hash`. A bare yes is not enough: a key
/// pressed before the summary was on screen is already waiting in the input, and it must not be able to confirm what
/// the user has not seen.
fn confirmed(ports: &mut TrustPorts, summary: &str, hash: &str) -> bool {
    let code: String = hash.chars().take(CODE_LENGTH).collect();
    let question = format!(
        "Trust this workflow and run it? To confirm, type {code} (the first {CODE_LENGTH} characters of the trust \
         hash). Anything else cancels:"
    );
    ports.terminal.confirm(summary, &question, &code)
}

/// `flow trust <name> [--yes]`.
fn trust_workflow(
    context: &Context,
    name: &str,
    yes: bool,
    ports: &mut TrustPorts,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    let (name, found, _) = match find(context, name, out, err) {
        Ok(found) => found,
        Err(code) => return code,
    };
    let checked = check_text(&name, &found.text, &found.source);
    if !checked.is_valid() {
        print_show(&checked, found.scope, &[], context.json, out, err);
        return EXIT_WORKFLOW_ERRORS;
    }
    let mut assessment = assess(context, &checked, &found, &trust_catalog(context));
    if matches!(
        resolve_harness(None, installed_runners(context.home), None, None),
        Ok(HarnessChoice::Claude)
    ) {
        add_claude_mismatches(&mut assessment, &checked, &claude_catalog(context), context);
    }
    let subject = Subject {
        name: &name,
        checked: &checked,
        found: &found,
        assessment: &assessment,
    };
    let Some(hash) = assessment.hash.as_deref() else {
        return refuse_unreadable_config(&name, &assessment, context, out, err);
    };
    if !assessment.ambiguous_agents.is_empty() {
        return refuse_ambiguous_agent(&name, &assessment, context, out, err);
    }
    if !assessment.needed {
        let message = format!(
            "No trust is needed for the {} workflow `{name}`: this repository has no tool configuration files. \
             Nothing was recorded.",
            scope_name(found.scope)
        );
        return print_trust_result(context, &name, hash, false, &message, out);
    }
    let key = match repo_key(context) {
        Ok(key) => key,
        Err(message) => return record_error(&message, context, out, err),
    };
    if let Err(error) = ports.store.can_record() {
        return record_error(&error.0, context, out, err);
    }
    if !yes && ports.store.recorded(&key, &name).as_deref() == Some(hash) {
        let message = format!("`{name}` is already trusted ({hash}).");
        return print_trust_result(context, &name, hash, true, &message, out);
    }
    if !yes {
        if !ports.terminal.is_available() {
            let message = format!(
                "There is no terminal to ask, so `{name}` was not trusted. Run `konductor flow trust {name}` in a \
                 terminal, or pass `--yes` to confirm without being asked."
            );
            return not_trusted(&message, hash, context, out, err);
        }
        let Some(summary) = summary_text(&subject) else {
            return runtime_error("The workflow cannot be summarised.", context, out, err);
        };
        if !confirmed(ports, &summary, hash) {
            let message = format!("The workflow `{name}` was not trusted.");
            return not_trusted(&message, hash, context, out, err);
        }
    }
    if let Err(error) = ports.store.record(&key, &name, hash) {
        return record_error(&error.0, context, out, err);
    }
    let message = format!("Trusted `{name}` ({hash}).");
    print_trust_result(context, &name, hash, true, &message, out)
}

/// `flow trust --revoke <name>`.
fn revoke_trust(
    context: &Context,
    name: &str,
    store: &mut dyn TrustStore,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    let name = match parse_reference(name) {
        Ok(Reference::Local(name)) => name,
        Ok(Reference::Shipped(_)) => {
            let message = "Shipped workflows (`library/<name>`) are not available yet.";
            return usage_error(message, context, out, err);
        }
        Err(ReferenceError::InvalidName) => {
            let message = format!("A workflow name {}.", workflow_core::rules::NAME_RULE);
            return usage_error(&message, context, out, err);
        }
    };
    let key = match repo_key(context) {
        Ok(key) => key,
        Err(message) => return record_error(&message, context, out, err),
    };
    let removed = match store.revoke(&key, &name) {
        Ok(removed) => removed,
        Err(error) => return record_error(&error.0, context, out, err),
    };
    let message = if removed {
        format!("Removed the trust record of `{name}`.")
    } else {
        format!("`{name}` has no trust record. Nothing was removed.")
    };
    if context.json {
        let mut object = Json::object();
        object.insert("name", Json::str(&name));
        object.insert("revoked", Json::Bool(removed));
        let _ = writeln!(out, "{}", object.compact());
    } else {
        let _ = writeln!(out, "{message}");
    }
    0
}

fn print_trust_result(
    context: &Context,
    name: &str,
    hash: &str,
    trusted: bool,
    message: &str,
    out: &mut dyn Write,
) -> u8 {
    if context.json {
        let mut object = Json::object();
        object.insert("name", Json::str(name));
        object.insert("trust_hash", Json::str(hash));
        object.insert("trusted", Json::Bool(trusted));
        let _ = writeln!(out, "{}", object.compact());
    } else {
        let _ = writeln!(out, "{message}");
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use workflow_core::ports::{Session, SessionEnd, SessionOutcome};

    #[test]
    fn a_swept_group_names_its_deadline_only_when_the_record_has_one() {
        let mut group = ProcessGroup {
            pgid: 42,
            started: "x".to_string(),
            deadline_ms: None,
        };
        assert_eq!(deadline_note(&group), "");
        group.deadline_ms = Some(1_793_881_800_000);
        assert_eq!(
            deadline_note(&group),
            " (its time limit ends at 2026-11-05T12:30:00Z)"
        );
    }

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

    fn first_line(text: &str) -> &str {
        text.lines().next().unwrap_or("")
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
            cwd: &scratch.0,
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
            (code, first_line(&out), err.as_str()),
            (0, "ok: plan (project, 1 stage)", "")
        );
        assert!(
            out.lines().nth(1).unwrap().starts_with("trust hash: "),
            "{out}"
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
            (code, first_line(&out), err.as_str()),
            (0, "ok: plan (user, 1 stage)", "")
        );
    }

    #[test]
    fn a_project_file_that_was_passed_over_is_named_in_a_note() {
        let scratch = Scratch::new("skipped");
        scratch.write("big.yml", &"#".repeat(262_145));
        scratch.write_user("big.yml", VALID.replace("plan", "big").as_str());
        let (code, out, err) = run_with(&scratch, Some(&scratch.1), Command::Check, "big", false);
        assert_eq!(code, 0, "{out} {err}");
        assert_eq!(first_line(&out), "ok: big (user, 1 stage)");
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

    // --- trust ------------------------------------------------------------------------------------------------

    /// A terminal that answers from a list and keeps what it was shown.
    struct Scripted {
        available: bool,
        answers: Vec<bool>,
        shown: Vec<String>,
        questions: Vec<String>,
        /// What the user would have to type for each question.
        codes: Vec<String>,
        /// Runs after the summary is shown and before the answer is given, like an edit made while the user reads.
        while_reading: Option<Box<dyn Fn()>>,
    }

    impl Scripted {
        fn new(available: bool, answers: &[bool]) -> Scripted {
            Scripted {
                available,
                answers: answers.to_vec(),
                shown: Vec::new(),
                questions: Vec::new(),
                codes: Vec::new(),
                while_reading: None,
            }
        }
    }

    impl Terminal for Scripted {
        fn is_available(&self) -> bool {
            self.available
        }

        fn confirm(&mut self, summary: &str, question: &str, code: &str) -> bool {
            self.shown.push(summary.to_string());
            self.questions.push(question.to_string());
            self.codes.push(code.to_string());
            if let Some(edit) = &self.while_reading {
                edit();
            }
            self.answers.remove(0)
        }
    }

    const PASSING: &str = r#"{"stages": {"plan": {"reply": "KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": []}"}}}"#;

    fn run_trusted(
        scratch: &Scratch,
        terminal: &mut Scripted,
        offered: Option<&str>,
    ) -> (u8, String, String) {
        run_trusted_at(scratch, &scratch.0, terminal, offered)
    }

    fn run_trusted_at(
        scratch: &Scratch,
        project: &Path,
        terminal: &mut Scripted,
        offered: Option<&str>,
    ) -> (u8, String, String) {
        let script = scratch.0.join("script.json");
        fs::write(&script, PASSING).unwrap();
        let args = RunArgs {
            goal: Some("Do it.".into()),
            harness: Some("fake".into()),
            fake_script: Some(script),
            fake_script_env: None,
            trust: offered.map(str::to_string),
        };
        let mut store = FileTrustStore::new(Some(&scratch.1));
        let mut ports = TrustPorts {
            store: &mut store,
            terminal,
        };
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let context = Context {
            cwd: project,
            project_root: project,
            home: Some(&scratch.1),
            json: false,
            color: ColorMode::disabled(),
        };
        let code = run_workflow(&context, "plan", &args, &mut ports, &mut out, &mut err);
        (
            code,
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
        )
    }

    fn ran(scratch: &Scratch) -> bool {
        scratch.0.join(".konductor/runs").exists()
    }

    #[test]
    fn yes_at_the_prompt_records_trust_and_runs_and_the_second_run_does_not_ask() {
        let scratch = Scratch::new("trust-yes");
        scratch.write("plan.yml", VALID);
        let mut terminal = Scripted::new(true, &[true]);
        let (code, out, err) = run_trusted(&scratch, &mut terminal, None);
        assert_eq!(code, 0, "{out} {err}");
        assert!(ran(&scratch));
        // The user types the first characters of the hash that the summary shows, and the question says so.
        let hash = hash_of(&scratch, "plan");
        assert_eq!(terminal.codes, [hash[..8].to_string()]);
        assert!(terminal.shown[0].contains(&format!("Trust hash: {hash}\n")));
        assert!(
            terminal.questions[0].contains(&format!("type {} ", &hash[..8])),
            "{:?}",
            terminal.questions
        );
        assert!(!terminal.questions[0].contains("y/N"));
        let mut terminal = Scripted::new(true, &[]);
        let second = run_trusted(&scratch, &mut terminal, None);
        assert_eq!(second.0, 0, "{} {}", second.1, second.2);
        assert!(terminal.shown.is_empty());
    }

    #[test]
    fn no_at_the_prompt_exits_77_and_runs_nothing() {
        let scratch = Scratch::new("trust-no");
        scratch.write("plan.yml", VALID);
        let mut terminal = Scripted::new(true, &[false]);
        let (code, out, err) = run_trusted(&scratch, &mut terminal, None);
        assert_eq!((code, out.as_str()), (EXIT_NOT_TRUSTED, ""));
        assert!(err.contains("was not trusted, so nothing ran"), "{err}");
        assert!(!ran(&scratch));
        assert!(!scratch.1.join(".konductor/trust.json").exists());
    }

    #[test]
    fn a_changed_workflow_or_prompt_file_asks_again() {
        let scratch = Scratch::new("trust-changed");
        scratch.write(
            "plan.yml",
            &VALID.replace(
                "agent: k-architect",
                "agent: k-architect\n    prompt_file: p.md",
            ),
        );
        scratch.write("p.md", "One.");
        let mut terminal = Scripted::new(true, &[true]);
        assert_eq!(run_trusted(&scratch, &mut terminal, None).0, 0);
        scratch.write("p.md", "Two.");
        let mut terminal = Scripted::new(true, &[true]);
        assert_eq!(run_trusted(&scratch, &mut terminal, None).0, 0);
        assert_eq!(
            terminal.shown.len(),
            1,
            "the prompt file changed, so it asked"
        );
        scratch.write("plan.yml", &VALID.replace("Do it.", "Do it!"));
        let mut terminal = Scripted::new(true, &[false]);
        assert_eq!(
            run_trusted(&scratch, &mut terminal, None).0,
            EXIT_NOT_TRUSTED
        );
        assert_eq!(terminal.shown.len(), 1);
    }

    #[test]
    fn no_terminal_exits_77_and_names_both_ways() {
        let scratch = Scratch::new("trust-none");
        scratch.write("plan.yml", VALID);
        let mut terminal = Scripted::new(false, &[]);
        let (code, _, err) = run_trusted(&scratch, &mut terminal, None);
        assert_eq!(code, EXIT_NOT_TRUSTED);
        assert!(err.contains("konductor flow trust plan"), "{err}");
        assert!(err.contains("--trust <hash>"), "{err}");
        assert!(err.contains("KONDUCTOR_TRUST=<hash>"), "{err}");
        assert!(terminal.shown.is_empty());
        assert!(!ran(&scratch));
    }

    #[test]
    fn a_trust_hash_that_matches_permits_one_run_and_records_nothing() {
        let scratch = Scratch::new("trust-flag");
        scratch.write("plan.yml", VALID);
        let hash = hash_of(&scratch, "plan");
        let mut terminal = Scripted::new(false, &[]);
        assert_eq!(run_trusted(&scratch, &mut terminal, Some(&hash)).0, 0);
        assert!(!scratch.1.join(".konductor/trust.json").exists());
        assert_eq!(
            run_trusted(&scratch, &mut terminal, None).0,
            EXIT_NOT_TRUSTED
        );
    }

    #[test]
    fn a_trust_hash_that_differs_exits_77_and_prints_both_hashes() {
        let scratch = Scratch::new("trust-mismatch");
        scratch.write("plan.yml", VALID);
        let hash = hash_of(&scratch, "plan");
        let wrong = "0".repeat(64);
        let mut terminal = Scripted::new(true, &[true]);
        let (code, _, err) = run_trusted(&scratch, &mut terminal, Some(&wrong));
        assert_eq!(code, EXIT_NOT_TRUSTED);
        assert!(err.contains(&wrong) && err.contains(&hash), "{err}");
        assert!(
            terminal.shown.is_empty(),
            "a wrong hash is not turned into a question"
        );
        assert!(!ran(&scratch));
    }

    fn hash_of(scratch: &Scratch, name: &str) -> String {
        let (_, out, _) = run_in(scratch, Command::Check, name, true);
        let at = out.find("\"trust_hash\":\"").unwrap() + "\"trust_hash\":\"".len();
        out[at..at + 64].to_string()
    }

    #[test]
    fn the_summary_lists_the_tools_each_agent_runs_without_asking() {
        let scratch = Scratch::new("trust-summary");
        scratch.write("plan.yml", VALID);
        fs::create_dir_all(scratch.1.join(".kiro/agents")).unwrap();
        fs::write(
            scratch.1.join(".kiro/agents/k-architect.json"),
            r#"{"allowedTools": ["fs_read", "@aws-mcp/read_docs"]}"#,
        )
        .unwrap();
        fs::create_dir_all(scratch.1.join(".claude/agents")).unwrap();
        fs::write(
            scratch.1.join(".claude/agents/k-architect.md"),
            "---\nname: k-architect\ntools: Read, WebFetch\n---\nBody\n",
        )
        .unwrap();
        let mut terminal = Scripted::new(true, &[false]);
        run_trusted(&scratch, &mut terminal, None);
        let shown = &terminal.shown[0];
        assert!(
            shown.contains(
                "kiro-cli (home folder): runs without asking: fs_read, @aws-mcp/read_docs"
            ),
            "{shown}"
        );
        assert!(shown.contains("claude (home folder): each tool in its tools list runs without asking: Read, WebFetch"), "{shown}");
        assert!(
            shown.contains("Workflow: plan\nPath: .konductor/workflows/plan.yml\nTrust hash: "),
            "{shown}"
        );
        assert!(shown.contains("Run checks: none"), "{shown}");
    }

    #[test]
    fn the_summary_names_the_file_the_unreadable_tools_and_the_keys_without_their_values() {
        let scratch = Scratch::new("trust-summary-keys");
        scratch.write("plan.yml", VALID);
        fs::create_dir_all(scratch.1.join(".claude/agents/team")).unwrap();
        fs::write(
            scratch.1.join(".claude/agents/team/k-architect.md"),
            "---\nname: k-architect\ntools: Bash(git status)\npermissionMode: bypassPermissions\n---\n",
        )
        .unwrap();
        fs::create_dir_all(scratch.0.join(".kiro/agents")).unwrap();
        fs::create_dir_all(scratch.1.join(".kiro/agents")).unwrap();
        fs::write(
            scratch.1.join(".kiro/agents/k-architect.json"),
            r#"{"allowedTools": ["shell"]}"#,
        )
        .unwrap();
        fs::write(
            scratch.0.join(".kiro/agents/k-architect.json"),
            r#"{"allowedTools": ["fs_read"]}"#,
        )
        .unwrap();
        let mut terminal = Scripted::new(true, &[false]);
        run_trusted(&scratch, &mut terminal, None);
        let shown = &terminal.shown[0];
        assert!(
            shown.contains("claude (home folder): tools: unreadable ("),
            "{shown}"
        );
        assert!(
            shown.contains("file: ~/.claude/agents/team/k-architect.md"),
            "{shown}"
        );
        assert!(shown.contains("also sets: permissionMode\n"), "{shown}");
        assert!(!shown.contains("bypassPermissions"), "{shown}");
        // The project's Kiro file wins over the home folder's, and the summary says which file it read.
        assert!(
            shown.contains("kiro-cli (project): runs without asking: fs_read"),
            "{shown}"
        );
        assert!(
            shown.contains("file: .kiro/agents/k-architect.json"),
            "{shown}"
        );
        assert!(!shown.contains("shell"), "{shown}");
    }

    /// Runs `plan` on `harness` from `cwd`, with `project` as the project root, and the user saying no. Returns what
    /// the summary showed.
    fn summary_on(scratch: &Scratch, harness: &str, cwd: &Path, project: &Path) -> String {
        let script = scratch.0.join("script.json");
        fs::write(&script, PASSING).unwrap();
        let args = RunArgs {
            goal: Some("Do it.".into()),
            harness: Some(harness.into()),
            fake_script: Some(script),
            fake_script_env: None,
            trust: None,
        };
        let mut terminal = Scripted::new(true, &[false]);
        let mut store = FileTrustStore::new(Some(&scratch.1));
        let mut ports = TrustPorts {
            store: &mut store,
            terminal: &mut terminal,
        };
        let context = Context {
            cwd,
            project_root: project,
            home: Some(&scratch.1),
            json: false,
            color: ColorMode::disabled(),
        };
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = run_workflow(&context, "plan", &args, &mut ports, &mut out, &mut err);
        assert_eq!(code, EXIT_NOT_TRUSTED, "{}", String::from_utf8_lossy(&err));
        let shown = terminal.shown.remove(0);
        // Only the agents part: the list of files the hash covers names every agent file of the repository.
        let end = shown.find("Run checks").unwrap();
        shown[..end].to_string()
    }

    fn write_agent(base: &Path, tools: &str) {
        let dir = base.join(".kiro/agents");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("k-architect.json"),
            format!(r#"{{"allowedTools": ["{tools}"]}}"#),
        )
        .unwrap();
    }

    #[test]
    fn on_kiro_a_file_in_a_folder_below_the_project_root_does_not_shadow_the_root_file() {
        let scratch = Scratch::new("trust-kiro-pkg");
        scratch.write("plan.yml", VALID);
        fs::create_dir_all(scratch.0.join(".git")).unwrap();
        let pkg = scratch.0.join("pkg");
        write_agent(&pkg, "shell");
        write_agent(&scratch.0, "fs_read");
        let shown = summary_on(&scratch, "kiro-cli", &pkg, &scratch.0);
        assert!(
            shown.contains("kiro-cli (project): runs without asking: fs_read"),
            "{shown}"
        );
        assert!(
            shown.contains("file: .kiro/agents/k-architect.json"),
            "{shown}"
        );
        assert!(
            !shown.contains("shell") && !shown.contains("pkg"),
            "{shown}"
        );
        // The fake harness keeps the search of the folders above the working folder.
        let fake = summary_on(&scratch, "fake", &pkg, &scratch.0);
        assert!(fake.contains("runs without asking: shell"), "{fake}");
    }

    #[test]
    fn on_kiro_the_summary_names_the_home_file_when_the_only_other_file_is_above_the_project_root()
    {
        let scratch = Scratch::new("trust-kiro-above");
        let app = scratch.0.join("app");
        fs::create_dir_all(app.join(".konductor/workflows")).unwrap();
        fs::write(app.join(".konductor/workflows/plan.yml"), VALID).unwrap();
        fs::create_dir_all(scratch.0.join(".git")).unwrap();
        write_agent(&scratch.0, "shell");
        write_agent(&scratch.1, "fs_read");
        let shown = summary_on(&scratch, "kiro-cli", &app, &app);
        assert!(
            shown.contains("kiro-cli (home folder): runs without asking: fs_read"),
            "{shown}"
        );
        assert!(
            shown.contains("file: ~/.kiro/agents/k-architect.json"),
            "{shown}"
        );
        assert!(!shown.contains("shell"), "{shown}");
        let fake = summary_on(&scratch, "fake", &app, &app);
        assert!(fake.contains("runs without asking: shell"), "{fake}");
    }

    #[test]
    fn the_summary_of_a_claude_agent_with_no_tools_key_lists_no_tool_names() {
        let scratch = Scratch::new("trust-summary-all");
        scratch.write("plan.yml", VALID);
        fs::create_dir_all(scratch.1.join(".claude/agents")).unwrap();
        fs::write(
            scratch.1.join(".claude/agents/k-architect.md"),
            "---\nname: k-architect\ndescription: Designs.\n---\nUse Read and Bash.\n",
        )
        .unwrap();
        let mut terminal = Scripted::new(true, &[false]);
        run_trusted(&scratch, &mut terminal, None);
        let shown = &terminal.shown[0];
        assert!(
            shown
                .contains("claude (home folder): every tool is available, and the file's tools key pre-approves none"),
            "{shown}"
        );
        assert!(!shown.contains("runs without asking"), "{shown}");
        assert!(
            !shown.contains("Read") && !shown.contains("Bash"),
            "{shown}"
        );
    }

    #[test]
    fn a_repo_with_tool_configuration_asks_for_a_user_workflow_too() {
        let scratch = Scratch::new("trust-config");
        scratch.write_user("plan.yml", VALID);
        let mut terminal = Scripted::new(true, &[]);
        assert_eq!(
            run_trusted(&scratch, &mut terminal, None).0,
            0,
            "no config, no question"
        );
        fs::create_dir_all(scratch.0.join(".claude")).unwrap();
        fs::write(scratch.0.join(".claude/settings.json"), "{}").unwrap();
        let mut terminal = Scripted::new(true, &[true]);
        assert_eq!(run_trusted(&scratch, &mut terminal, None).0, 0);
        let shown = &terminal.shown[0];
        assert!(
            shown.contains("Path: ~/.konductor/workflows/plan.yml"),
            "{shown}"
        );
        assert!(
            shown.contains("tool configuration files")
                && shown.contains("  .claude/settings.json\n"),
            "{shown}"
        );
        // Trusted now, until the settings change.
        let mut terminal = Scripted::new(true, &[]);
        assert_eq!(run_trusted(&scratch, &mut terminal, None).0, 0);
        fs::write(scratch.0.join(".claude/settings.json"), "{\"hooks\": {}}").unwrap();
        let mut terminal = Scripted::new(false, &[]);
        assert_eq!(
            run_trusted(&scratch, &mut terminal, None).0,
            EXIT_NOT_TRUSTED
        );
    }

    #[test]
    fn files_that_an_install_recorded_are_not_counted_but_only_with_the_index() {
        use crate::cli::install::index::{write_index_at_home, IndexEntry, IndexEntryStatus};
        let scratch = Scratch::new("trust-installed");
        scratch.write_user("plan.yml", VALID);
        fs::create_dir_all(scratch.0.join(".claude/agents")).unwrap();
        let agent = b"installed agent";
        fs::write(scratch.0.join(".claude/agents/k-a.md"), agent).unwrap();
        fs::write(
            scratch.0.join(".konductor/manifest"),
            format!(
                r#"{{"schema_version":2,"strategies":[{{"strategy":"claude","installed_at":"2026-01-01T00:00:00Z","destination":".","status":"complete","files":[{{"path":".claude/agents/k-a.md","sha256":"{}","provenance":"created"}}]}}]}}"#,
                workflow_core::trust::sha256_hex(agent)
            ),
        )
        .unwrap();
        // A manifest alone, as a clone could ship, vouches for nothing.
        let mut terminal = Scripted::new(false, &[]);
        assert_eq!(
            run_trusted(&scratch, &mut terminal, None).0,
            EXIT_NOT_TRUSTED
        );
        let canonical = fs::canonicalize(&scratch.0).unwrap();
        write_index_at_home(
            Some(&scratch.1),
            IndexEntry {
                target_dir: canonical.to_str().unwrap().to_string(),
                strategies: vec!["claude".into()],
                installed_at: "2026-01-01T00:00:00Z".into(),
                status: IndexEntryStatus::Complete,
            },
        )
        .unwrap();
        assert_eq!(run_trusted(&scratch, &mut terminal, None).0, 0);
        // A changed installed file counts again.
        fs::write(scratch.0.join(".claude/agents/k-a.md"), b"edited").unwrap();
        assert_eq!(
            run_trusted(&scratch, &mut terminal, None).0,
            EXIT_NOT_TRUSTED
        );
    }

    #[test]
    fn a_file_a_stage_adds_to_the_manifest_does_not_hide_itself_from_the_per_stage_scan() {
        use crate::cli::install::index::{write_index_at_home, IndexEntry, IndexEntryStatus};
        let scratch = Scratch::new("trust-installed-midrun");
        fs::create_dir_all(scratch.0.join(".claude/agents")).unwrap();
        fs::write(scratch.0.join(".claude/agents/k-a.md"), b"installed").unwrap();
        let manifest = |files: &[(&str, &[u8])]| {
            let listed: Vec<String> = files
                .iter()
                .map(|(path, bytes)| {
                    format!(
                        r#"{{"path":"{path}","sha256":"{}","provenance":"created"}}"#,
                        workflow_core::trust::sha256_hex(bytes)
                    )
                })
                .collect();
            fs::write(
                scratch.0.join(".konductor/manifest"),
                format!(
                    r#"{{"schema_version":2,"strategies":[{{"strategy":"claude","installed_at":"2026-01-01T00:00:00Z","destination":".","status":"complete","files":[{}]}}]}}"#,
                    listed.join(",")
                ),
            )
            .unwrap();
        };
        manifest(&[(".claude/agents/k-a.md", b"installed")]);
        write_index_at_home(
            Some(&scratch.1),
            IndexEntry {
                target_dir: fs::canonicalize(&scratch.0)
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_string(),
                strategies: vec!["claude".into()],
                installed_at: "2026-01-01T00:00:00Z".into(),
                status: IndexEntryStatus::Complete,
            },
        )
        .unwrap();
        let context = Context {
            cwd: &scratch.0,
            project_root: &scratch.0,
            home: Some(&scratch.1),
            json: false,
            color: ColorMode::disabled(),
        };
        let hash_with = |installed: &InstalledFiles| {
            workflow_core::trust::TrustInputs::default()
                .hash(&scan_config(&context, installed).expect("readable"))
        };
        let at_start = installed_files(&scratch.0, Some(&scratch.1));
        let before = hash_with(&at_start);
        // A stage adds a skill file that carries nothing and lists it, with its hash, in the manifest. (A settings, MCP
        // or hook file is counted whatever the manifest says, so it could not show the difference.)
        fs::create_dir_all(scratch.0.join(".claude/skills/new")).unwrap();
        fs::write(scratch.0.join(".claude/skills/new/SKILL.md"), b"plain").unwrap();
        manifest(&[
            (".claude/agents/k-a.md", b"installed"),
            (".claude/skills/new/SKILL.md", b"plain"),
        ]);
        // The set taken when the run was assessed still counts the new file, so the hash changes and the run halts.
        assert_ne!(hash_with(&at_start), before);
        // A set read from the manifest again would have hidden it.
        assert_eq!(
            hash_with(&installed_files(&scratch.0, Some(&scratch.1))),
            before
        );
    }

    fn trust_cmd(
        scratch: &Scratch,
        terminal: &mut Scripted,
        name: Option<&str>,
        yes: bool,
        revoke: Option<&str>,
        json: bool,
    ) -> (u8, String, String) {
        let mut store = FileTrustStore::new(Some(&scratch.1));
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let context = Context {
            cwd: &scratch.0,
            project_root: &scratch.0,
            home: Some(&scratch.1),
            json,
            color: ColorMode::disabled(),
        };
        let code = match (name, revoke) {
            (_, Some(revoked)) => revoke_trust(&context, revoked, &mut store, &mut out, &mut err),
            (Some(name), None) => {
                let mut ports = TrustPorts {
                    store: &mut store,
                    terminal,
                };
                trust_workflow(&context, name, yes, &mut ports, &mut out, &mut err)
            }
            (None, None) => unreachable!(),
        };
        (
            code,
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
        )
    }

    #[test]
    fn flow_trust_asks_records_and_revoke_removes_the_record() {
        let scratch = Scratch::new("trust-cmd");
        scratch.write("plan.yml", VALID);
        let mut terminal = Scripted::new(true, &[false, true]);
        let (code, _, _) = trust_cmd(&scratch, &mut terminal, Some("plan"), false, None, false);
        assert_eq!(code, EXIT_NOT_TRUSTED);
        assert!(!scratch.1.join(".konductor/trust.json").exists());
        let (code, out, _) = trust_cmd(&scratch, &mut terminal, Some("plan"), false, None, false);
        assert_eq!(code, 0);
        assert!(out.starts_with("Trusted `plan` ("), "{out}");
        let mut quiet = Scripted::new(false, &[]);
        assert_eq!(run_trusted(&scratch, &mut quiet, None).0, 0);
        let (code, out, _) = trust_cmd(&scratch, &mut quiet, None, false, Some("plan"), false);
        assert_eq!(
            (code, out.as_str()),
            (0, "Removed the trust record of `plan`.\n")
        );
        assert_eq!(run_trusted(&scratch, &mut quiet, None).0, EXIT_NOT_TRUSTED);
        let (code, out, _) = trust_cmd(&scratch, &mut quiet, None, false, Some("plan"), false);
        assert_eq!(
            (code, out.as_str()),
            (0, "`plan` has no trust record. Nothing was removed.\n")
        );
    }

    #[test]
    fn flow_trust_yes_records_without_a_terminal_or_a_question() {
        let scratch = Scratch::new("trust-yes-flag");
        scratch.write("plan.yml", VALID);
        let mut quiet = Scripted::new(false, &[]);
        let (code, _, err) = trust_cmd(&scratch, &mut quiet, Some("plan"), false, None, false);
        assert_eq!(code, EXIT_NOT_TRUSTED);
        assert!(err.contains("--yes"), "{err}");
        let (code, _, _) = trust_cmd(&scratch, &mut quiet, Some("plan"), true, None, false);
        assert_eq!(code, 0);
        assert_eq!(run_trusted(&scratch, &mut quiet, None).0, 0);
    }

    #[test]
    fn flow_trust_of_a_user_workflow_without_tool_configuration_writes_no_record() {
        let scratch = Scratch::new("trust-none-needed");
        scratch.write_user("plan.yml", VALID);
        let mut quiet = Scripted::new(false, &[]);
        let (code, out, _) = trust_cmd(&scratch, &mut quiet, Some("plan"), false, None, false);
        assert_eq!(code, 0);
        assert!(
            out.contains("No trust is needed for the user workflow `plan`"),
            "{out}"
        );
        assert!(!scratch.1.join(".konductor/trust.json").exists());
        let (code, _, _) = trust_cmd(&scratch, &mut quiet, Some("plan"), true, None, false);
        assert_eq!(code, 0);
        assert!(!scratch.1.join(".konductor/trust.json").exists());
    }

    #[test]
    fn flow_trust_of_a_broken_or_missing_workflow_is_refused_before_asking() {
        let scratch = Scratch::new("trust-broken");
        scratch.write("plan.yml", "a: [");
        let mut terminal = Scripted::new(true, &[true]);
        let (code, _, _) = trust_cmd(&scratch, &mut terminal, Some("plan"), false, None, false);
        assert_eq!(code, EXIT_WORKFLOW_ERRORS);
        let (code, _, _) = trust_cmd(&scratch, &mut terminal, Some("ghost"), false, None, false);
        assert_eq!(code, EXIT_USAGE_ERROR);
        let (code, _, _) = trust_cmd(
            &scratch,
            &mut terminal,
            None,
            false,
            Some("Bad Name"),
            false,
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        assert!(terminal.shown.is_empty());
    }

    #[test]
    fn an_unreadable_record_trusts_nothing() {
        let scratch = Scratch::new("trust-unreadable");
        scratch.write("plan.yml", VALID);
        let mut terminal = Scripted::new(true, &[true]);
        assert_eq!(run_trusted(&scratch, &mut terminal, None).0, 0);
        fs::write(scratch.1.join(".konductor/trust.json"), "not json").unwrap();
        let mut quiet = Scripted::new(false, &[]);
        assert_eq!(run_trusted(&scratch, &mut quiet, None).0, EXIT_NOT_TRUSTED);
    }

    // --- the scan fails closed -----------------------------------------------------------------------------------

    /// The hash of `plan` and its files alone, with no tool configuration file in it. It is what a hash of this
    /// repository would be if the entry the scan cannot read were simply left out.
    fn hash_without_config(scratch: &Scratch) -> String {
        let source = workflow_adapters::FileSource::under(&scratch.0);
        check_text("plan", VALID, &source).trust_inputs.hash(&[])
    }

    /// One case the scan cannot read in full: a label, how to set it up, and the file behind it.
    type MarkerSetup = Box<dyn Fn(&Scratch)>;
    type MarkerCase = (&'static str, MarkerSetup, &'static str);

    /// Sets up each case the scan cannot read in full, with `evil.md` behind it where there is one.
    fn marker_cases() -> Vec<MarkerCase> {
        vec![
            (
                "link",
                Box::new(|s: &Scratch| {
                    fs::create_dir_all(s.0.join("elsewhere")).unwrap();
                    fs::write(s.0.join("elsewhere/evil.md"), "one").unwrap();
                    fs::create_dir_all(s.0.join(".claude")).unwrap();
                    std::os::unix::fs::symlink(s.0.join("elsewhere"), s.0.join(".claude/agents"))
                        .unwrap();
                }),
                "elsewhere/evil.md",
            ),
            (
                "cap-shared",
                Box::new(|s: &Scratch| {
                    fs::create_dir_all(s.0.join(".kiro/agents")).unwrap();
                    for n in 0..600 {
                        fs::write(s.0.join(format!(".kiro/agents/a{n:04}.json")), "{}").unwrap();
                    }
                    fs::create_dir_all(s.0.join(".claude/agents")).unwrap();
                    fs::write(s.0.join(".claude/agents/evil.md"), "one").unwrap();
                }),
                ".claude/agents/evil.md",
            ),
            (
                "cap-one-folder",
                Box::new(|s: &Scratch| {
                    fs::create_dir_all(s.0.join(".claude/agents")).unwrap();
                    for n in 0..600 {
                        fs::write(s.0.join(format!(".claude/agents/a{n:04}.md")), "x").unwrap();
                    }
                }),
                ".claude/agents/a0599.md",
            ),
            (
                "deep",
                Box::new(|s: &Scratch| {
                    fs::create_dir_all(s.0.join(".claude/agents/a/b/c/d/e")).unwrap();
                    fs::write(s.0.join(".claude/agents/a/b/c/d/e/evil.md"), "one").unwrap();
                }),
                ".claude/agents/a/b/c/d/e/evil.md",
            ),
            (
                "over-1-mib",
                Box::new(|s: &Scratch| {
                    fs::write(s.0.join(".mcp.json"), vec![b'x'; 1024 * 1024 + 1]).unwrap();
                }),
                "no-file-behind-this-one",
            ),
        ]
    }

    #[test]
    fn an_unreadable_config_entry_refuses_every_way_in_whatever_hash_is_passed() {
        for (label, setup, evil) in marker_cases() {
            let scratch = Scratch::new(&format!("marker-{label}"));
            scratch.write("plan.yml", VALID);
            setup(&scratch);
            let evil = scratch.0.join(evil);
            // There is no hash of such a repository to print, and so none to pass.
            let (_, checked_out, _) = run_in(&scratch, Command::Check, "plan", true);
            assert!(
                !checked_out.contains("trust_hash"),
                "{label}: {checked_out}"
            );
            let (_, checked_text, _) = run_in(&scratch, Command::Check, "plan", false);
            assert!(
                checked_text.contains("trust hash: none"),
                "{label}: {checked_text}"
            );
            let offered = hash_without_config(&scratch);
            // With a terminal that says yes, the run is still refused, and nothing is asked or recorded.
            let mut terminal = Scripted::new(true, &[true]);
            let (code, _, err) = run_trusted(&scratch, &mut terminal, None);
            assert_eq!(code, EXIT_NOT_TRUSTED, "{label}: {err}");
            assert!(err.contains("cannot be read in full"), "{label}: {err}");
            assert!(terminal.shown.is_empty(), "{label}");
            // `--trust` does not unlock it, whether the hash is the workflow's alone or not a hash at all.
            for given in [offered.as_str(), "0000"] {
                let (code, _, err) = run_trusted(&scratch, &mut terminal, Some(given));
                assert_eq!(code, EXIT_NOT_TRUSTED, "{label}: --trust {given}");
                assert!(err.contains("cannot be read in full"), "{label}: {err}");
            }
            // `flow trust --yes` and the question both refuse.
            let (code, _, err) =
                trust_cmd(&scratch, &mut terminal, Some("plan"), true, None, false);
            assert_eq!(code, EXIT_NOT_TRUSTED, "{label}: --yes {err}");
            let (code, _, _) = trust_cmd(&scratch, &mut terminal, Some("plan"), false, None, false);
            assert_eq!(code, EXIT_NOT_TRUSTED, "{label}: ask");
            assert!(!scratch.1.join(".konductor/trust.json").exists(), "{label}");
            assert!(!ran(&scratch), "{label}");
            // An edit behind the entry cannot show in a hash, which is why the run is refused and not hashed.
            if evil.exists() {
                fs::write(&evil, "two").unwrap();
                let (code, _, _) = run_trusted(&scratch, &mut terminal, Some(&offered));
                assert_eq!(code, EXIT_NOT_TRUSTED, "{label}: after the edit");
            }
        }
    }

    /// Each way the scan refuses, with the path it names and the words that give the cause.
    fn refusal_causes() -> Vec<(&'static str, MarkerSetup, &'static str, &'static str)> {
        vec![
            (
                "link-to-folder",
                Box::new(|s: &Scratch| {
                    fs::create_dir_all(s.0.join("shared")).unwrap();
                    fs::create_dir_all(s.0.join(".claude")).unwrap();
                    std::os::unix::fs::symlink(s.0.join("shared"), s.0.join(".claude/skills"))
                        .unwrap();
                }),
                ".claude/skills",
                "is a link to a folder, which is not followed",
            ),
            (
                "dangling-link",
                Box::new(|s: &Scratch| {
                    fs::create_dir_all(s.0.join(".claude/agents")).unwrap();
                    std::os::unix::fs::symlink(
                        s.0.join("missing.md"),
                        s.0.join(".claude/agents/gone.md"),
                    )
                    .unwrap();
                }),
                ".claude/agents/gone.md",
                "is a link that cannot be followed",
            ),
            (
                "too-many",
                Box::new(|s: &Scratch| {
                    fs::create_dir_all(s.0.join(".claude/hooks")).unwrap();
                    for n in 0..513 {
                        fs::write(s.0.join(format!(".claude/hooks/h{n:04}")), "x").unwrap();
                    }
                }),
                ".claude/hooks",
                "more than 512 files and folders",
            ),
            (
                "too-deep",
                Box::new(|s: &Scratch| {
                    fs::create_dir_all(s.0.join(".claude/agents/a/b/c/d/e")).unwrap();
                    fs::write(s.0.join(".claude/agents/a/b/c/d/e/x.md"), "x").unwrap();
                }),
                ".claude/agents/a/b/c/d/e",
                "deeper than 4 levels",
            ),
            (
                "too-big",
                Box::new(|s: &Scratch| {
                    fs::create_dir_all(s.0.join(".claude/skills/s")).unwrap();
                    fs::write(
                        s.0.join(".claude/skills/s/asset.bin"),
                        vec![b'x'; 1024 * 1024 + 1],
                    )
                    .unwrap();
                }),
                ".claude/skills/s/asset.bin",
                "over 1 MiB",
            ),
        ]
    }

    #[test]
    fn every_refusal_of_the_scan_names_its_path_and_cause_in_the_run_and_in_flow_check() {
        for (label, setup, path, cause) in refusal_causes() {
            let scratch = Scratch::new(&format!("cause-{label}"));
            scratch.write("plan.yml", VALID);
            setup(&scratch);
            let mut terminal = Scripted::new(true, &[true]);
            let (code, _, err) = run_trusted(&scratch, &mut terminal, None);
            assert_eq!(code, EXIT_NOT_TRUSTED, "{label}: {err}");
            assert!(err.contains(&format!(" {path} ")), "{label}: {err}");
            assert!(err.contains(cause), "{label}: {err}");
            let (_, text, _) = run_in(&scratch, Command::Check, "plan", false);
            assert!(text.contains(&format!("`{path}` ")), "{label}: {text}");
            assert!(text.contains(cause), "{label}: {text}");
            let (_, json, _) = run_in(&scratch, Command::Check, "plan", true);
            let report: serde_json::Value = serde_json::from_str(&json).unwrap();
            assert!(report.get("trust_hash").is_none(), "{label}: {json}");
            let first = &report["unreadable_config"][0];
            assert_eq!(first["path"], path, "{label}: {json}");
            assert!(
                first["reason"].as_str().unwrap().contains(cause),
                "{label}: {json}"
            );
        }
    }

    #[test]
    fn a_link_to_a_file_in_a_covered_folder_is_read_and_needs_trust_like_the_file() {
        let scratch = Scratch::new("cause-file-link");
        scratch.write("plan.yml", VALID);
        fs::create_dir_all(scratch.0.join("shared")).unwrap();
        fs::write(scratch.0.join("shared/hook.sh"), "echo one").unwrap();
        fs::create_dir_all(scratch.0.join(".claude/hooks")).unwrap();
        std::os::unix::fs::symlink(
            scratch.0.join("shared/hook.sh"),
            scratch.0.join(".claude/hooks/hook.sh"),
        )
        .unwrap();
        let (code, text, _) = run_in(&scratch, Command::Check, "plan", false);
        assert_eq!(code, 0);
        assert!(text.contains("trust hash: "), "{text}");
        assert!(!text.contains("trust hash: none"), "{text}");
        let mut terminal = Scripted::new(true, &[true]);
        assert_eq!(run_trusted(&scratch, &mut terminal, None).0, 0);
        assert_eq!(terminal.shown.len(), 1, "the linked file asked");
    }

    #[test]
    fn under_json_an_unreadable_config_entry_has_its_own_code_and_no_hash() {
        let scratch = Scratch::new("marker-json");
        scratch.write("plan.yml", VALID);
        fs::create_dir_all(scratch.0.join(".claude/agents/a/b/c/d/e")).unwrap();
        let mut store = FileTrustStore::new(Some(&scratch.1));
        let mut terminal = Scripted::new(true, &[]);
        let mut ports = TrustPorts {
            store: &mut store,
            terminal: &mut terminal,
        };
        let script = scratch.0.join("script.json");
        fs::write(&script, PASSING).unwrap();
        let args = RunArgs {
            goal: Some("Do it.".into()),
            harness: Some("fake".into()),
            fake_script: Some(script),
            fake_script_env: None,
            trust: None,
        };
        let context = Context {
            cwd: &scratch.0,
            project_root: &scratch.0,
            home: Some(&scratch.1),
            json: true,
            color: ColorMode::disabled(),
        };
        let (mut out, mut err) = (Vec::new(), Vec::new());
        // An empty folder is not a marker; a folder nested too deep is.
        fs::write(scratch.0.join(".claude/agents/a/b/c/d/e/x.md"), "x").unwrap();
        let code = run_workflow(&context, "plan", &args, &mut ports, &mut out, &mut err);
        assert_eq!(code, EXIT_NOT_TRUSTED);
        let envelope: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(envelope["code"], "tool_config_unreadable");
        assert!(envelope.get("trust_hash").is_none(), "{envelope}");
    }

    #[test]
    fn a_folder_above_the_project_up_to_the_git_root_needs_trust() {
        let scratch = Scratch::new("trust-above");
        fs::create_dir_all(scratch.0.join(".git")).unwrap();
        fs::create_dir_all(scratch.0.join(".claude")).unwrap();
        fs::write(scratch.0.join(".claude/settings.json"), "{}").unwrap();
        let sub = scratch.0.join("pkg/app");
        fs::create_dir_all(sub.join(".konductor/workflows")).unwrap();
        fs::write(sub.join(".konductor/workflows/plan.yml"), VALID).unwrap();
        let mut terminal = Scripted::new(true, &[true]);
        assert_eq!(run_trusted_at(&scratch, &sub, &mut terminal, None).0, 0);
        assert!(
            terminal.shown[0].contains("  .claude/settings.json\n"),
            "{}",
            terminal.shown[0]
        );
        fs::write(scratch.0.join(".claude/settings.json"), "{\"hooks\": {}}").unwrap();
        let mut quiet = Scripted::new(false, &[]);
        assert_eq!(
            run_trusted_at(&scratch, &sub, &mut quiet, None).0,
            EXIT_NOT_TRUSTED
        );
    }

    #[test]
    fn a_missing_home_is_reported_before_the_question_and_does_not_exit_1() {
        let scratch = Scratch::new("trust-no-home");
        scratch.write("plan.yml", VALID);
        let mut store = FileTrustStore::new(None);
        let mut terminal = Scripted::new(true, &[true]);
        let mut ports = TrustPorts {
            store: &mut store,
            terminal: &mut terminal,
        };
        let script = scratch.0.join("script.json");
        fs::write(&script, PASSING).unwrap();
        let args = RunArgs {
            goal: Some("Do it.".into()),
            harness: Some("fake".into()),
            fake_script: Some(script),
            fake_script_env: None,
            trust: None,
        };
        let context = Context {
            cwd: &scratch.0,
            project_root: &scratch.0,
            home: None,
            json: false,
            color: ColorMode::disabled(),
        };
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = run_workflow(&context, "plan", &args, &mut ports, &mut out, &mut err);
        assert_eq!(code, EXIT_RECORD);
        assert!(String::from_utf8(err).unwrap().contains("HOME is not set"));
        assert!(terminal.shown.is_empty());
        assert!(!ran(&scratch));
    }

    #[test]
    fn flow_trust_on_a_trusted_workflow_says_so_and_yes_records_again() {
        let scratch = Scratch::new("trust-already");
        scratch.write("plan.yml", VALID);
        let mut terminal = Scripted::new(true, &[true]);
        let (code, _, _) = trust_cmd(&scratch, &mut terminal, Some("plan"), false, None, false);
        assert_eq!(code, 0);
        let (code, out, _) = trust_cmd(&scratch, &mut terminal, Some("plan"), false, None, false);
        assert_eq!(code, 0);
        assert!(out.starts_with("`plan` is already trusted ("), "{out}");
        assert!(terminal.questions.len() == 1, "asked only once");
        let (code, out, _) = trust_cmd(&scratch, &mut terminal, Some("plan"), true, None, false);
        assert_eq!(code, 0);
        assert!(out.starts_with("Trusted `plan` ("), "{out}");
    }

    // --- the files are read again before each session -------------------------------------------------------------

    #[test]
    fn a_file_edited_while_the_summary_is_on_screen_does_not_run_under_that_confirmation() {
        let scratch = Scratch::new("trust-reading");
        scratch.write("plan.yml", VALID);
        fs::write(scratch.0.join(".mcp.json"), "{}").unwrap();
        let mut terminal = Scripted::new(true, &[true]);
        let project = scratch.0.clone();
        terminal.while_reading = Some(Box::new(move || {
            fs::write(
                project.join(".mcp.json"),
                r#"{"mcpServers": {"x": {"command": "evil"}}}"#,
            )
            .unwrap();
        }));
        let (code, out, err) = run_trusted(&scratch, &mut terminal, None);
        assert_eq!(code, EXIT_HALTED, "{out} {err}");
        assert!(
            err.contains("changed after the workflow was confirmed"),
            "{err}"
        );
        assert!(err.contains("Stage `plan` did not start"), "{err}");
        assert!(err.contains("`.mcp.json` was edited"), "{err}");
        assert!(
            out.contains("stage plan: blocked (SESSION_FAILED)"),
            "{out}"
        );
        // The record holds the hash that was on screen, so the edited files ask again.
        let mut terminal = Scripted::new(true, &[true]);
        assert_eq!(run_trusted(&scratch, &mut terminal, None).0, 0);
        assert_eq!(terminal.shown.len(), 1, "the edited file asked again");
        assert!(terminal.shown[0].contains("server x runs: evil"));
    }

    /// A harness that edits a file during its first session.
    struct Editing {
        sessions: usize,
        edit: Box<dyn Fn()>,
    }

    impl workflow_core::ports::Harness for Editing {
        fn run_session(&mut self, _: &Session) -> SessionOutcome {
            self.sessions += 1;
            (self.edit)();
            SessionOutcome {
                end: SessionEnd::Exited(0),
                final_message: String::new(),
            }
        }
    }

    #[test]
    fn a_stage_that_edits_the_tool_configuration_stops_the_sessions_after_it() {
        use workflow_core::ports::Harness as _;
        let scratch = Scratch::new("trust-guard");
        let (project, home) = (scratch.0.clone(), scratch.1.clone());
        let checked = check_text(
            "plan",
            VALID,
            &workflow_adapters::FileSource::under(&project),
        );
        let context = Context {
            cwd: &project,
            project_root: &project,
            home: Some(&home),
            json: false,
            color: ColorMode::disabled(),
        };
        let config = scan_config(&context, &InstalledFiles::new()).expect("readable");
        let hash = checked.trust_inputs.hash(&config);
        let edited = project.clone();
        let mut inner = Editing {
            sessions: 0,
            edit: Box::new(move || {
                fs::create_dir_all(edited.join(".claude")).unwrap();
                fs::write(edited.join(".claude/settings.local.json"), "{}").unwrap();
            }),
        };
        let unchanged = || {
            config_unchanged(
                &context,
                &InstalledFiles::new(),
                &checked.trust_inputs,
                &config,
                &hash,
            )
        };
        let mut guard = GuardedHarness::new(&mut inner, &unchanged);
        let session = |stage| Session {
            stage,
            agent: "k-architect",
            prompt: "p",
            time_limit_ms: 1,
        };
        // The first session starts, and it adds a file that a tool would load. The next one does not start, and
        // neither does any later one.
        assert_eq!(
            guard.run_session(&session("one")).end,
            SessionEnd::Exited(0)
        );
        assert_eq!(
            guard.run_session(&session("two")).end,
            SessionEnd::NotStarted
        );
        assert_eq!(
            guard.run_session(&session("three")).end,
            SessionEnd::NotStarted
        );
        assert_eq!(guard.refused_stage(), Some("two"));
        // The cause names the file the stage added, and the message says nothing was confirmed.
        assert_eq!(
            guard.refused_cause(),
            Some("`.claude/settings.local.json` was added")
        );
        drop(guard);
        assert_eq!(inner.sessions, 1);
        let message = halt_message(
            false,
            "two",
            "`.claude/settings.local.json` was added",
            "plan",
        );
        assert!(message
            .contains("changed since the run started: `.claude/settings.local.json` was added."));
        assert!(!message.contains("confirmed"), "{message}");
        let message = halt_message(true, "two", "`.mcp.json` was edited", "plan");
        assert!(
            message.contains("changed after the workflow was confirmed: `.mcp.json` was edited.")
        );
    }

    #[test]
    fn the_check_before_a_session_names_an_edited_a_removed_or_an_unreadable_file() {
        let scratch = Scratch::new("trust-cause");
        let (project, home) = (scratch.0.clone(), scratch.1.clone());
        scratch.write("plan.yml", VALID);
        fs::create_dir_all(project.join(".claude")).unwrap();
        fs::write(project.join(".mcp.json"), "{}").unwrap();
        fs::write(project.join(".claude/settings.json"), "{}").unwrap();
        let checked = check_text(
            "plan",
            VALID,
            &workflow_adapters::FileSource::under(&project),
        );
        let context = Context {
            cwd: &project,
            project_root: &project,
            home: Some(&home),
            json: false,
            color: ColorMode::disabled(),
        };
        let installed = InstalledFiles::new();
        let config = scan_config(&context, &installed).expect("readable");
        let hash = checked.trust_inputs.hash(&config);
        let check =
            || config_unchanged(&context, &installed, &checked.trust_inputs, &config, &hash);
        assert_eq!(check(), Ok(()));
        fs::write(project.join(".mcp.json"), r#"{"mcpServers": {}}"#).unwrap();
        assert_eq!(check(), Err("`.mcp.json` was edited".to_string()));
        fs::write(project.join(".mcp.json"), "{}").unwrap();
        fs::remove_file(project.join(".claude/settings.json")).unwrap();
        assert_eq!(
            check(),
            Err("`.claude/settings.json` was removed".to_string())
        );
        // A file the scan cannot read names its path and the reason, not a changed hash.
        fs::write(project.join(".claude/settings.json"), "{}").unwrap();
        fs::create_dir_all(project.join(".claude/agents")).unwrap();
        std::os::unix::fs::symlink(
            project.join("nowhere.md"),
            project.join(".claude/agents/gone.md"),
        )
        .unwrap();
        assert_eq!(
            check(),
            Err("`.claude/agents/gone.md` is a link that cannot be followed".to_string())
        );
    }

    #[test]
    fn the_check_before_a_session_uses_the_same_manifest_rule_as_the_assessment() {
        use workflow_adapters::scan_repo_config;
        let scratch = Scratch::new("trust-guard-installed");
        let (project, home) = (scratch.0.clone(), scratch.1.clone());
        scratch.write("plan.yml", VALID);
        fs::create_dir_all(project.join(".claude")).unwrap();
        fs::write(project.join(".claude/settings.json"), "{}").unwrap();
        let checked = check_text(
            "plan",
            VALID,
            &workflow_adapters::FileSource::under(&project),
        );
        let context = Context {
            cwd: &project,
            project_root: &project,
            home: Some(&home),
            json: false,
            color: ColorMode::disabled(),
        };
        // The manifest vouches for the settings file, and it is still counted.
        let installed: InstalledFiles = std::collections::BTreeSet::from([(
            ".claude/settings.json".to_string(),
            workflow_core::trust::sha256_hex(b"{}"),
        )]);
        let config =
            scan_repo_config(&project, Some(&home), &project, &installed).expect("readable");
        assert_eq!(config.len(), 1, "a settings file is never exempt");
        let hash = checked.trust_inputs.hash(&config);
        let check =
            || config_unchanged(&context, &installed, &checked.trust_inputs, &config, &hash);
        assert_eq!(check(), Ok(()));
        fs::write(
            project.join(".claude/settings.json"),
            r#"{"hooks": {"Stop": []}}"#,
        )
        .unwrap();
        assert_eq!(
            check(),
            Err("`.claude/settings.json` was edited".to_string())
        );
    }

    #[test]
    fn an_edit_behind_each_covered_path_asks_again_and_without_a_terminal_is_refused() {
        let paths = [
            ".claude/settings.json",
            ".claude/settings.local.json",
            ".mcp.json",
            ".kiro/settings/mcp.json",
            ".kiro/agents/k-architect.json",
            ".claude/agents/k-architect.md",
            ".claude/commands/deploy.md",
            ".claude/skills/review/SKILL.md",
            ".claude/skills/review/run.sh",
            ".claude/hooks/pre-tool.sh",
        ];
        for path in paths {
            let scratch = Scratch::new("trust-paths");
            scratch.write("plan.yml", VALID);
            let file = scratch.0.join(path);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(&file, "one").unwrap();
            // `flow trust` and the refusal take no workspace lock, so the loop runs no stage.
            let mut terminal = Scripted::new(true, &[true]);
            let (code, _, _) = trust_cmd(&scratch, &mut terminal, Some("plan"), false, None, false);
            assert_eq!(code, 0, "{path}");
            let mut terminal = Scripted::new(false, &[]);
            let (_, out, _) = trust_cmd(&scratch, &mut terminal, Some("plan"), false, None, false);
            assert!(
                out.starts_with("`plan` is already trusted ("),
                "{path}: {out}"
            );
            fs::write(&file, "two").unwrap();
            let mut terminal = Scripted::new(false, &[]);
            let (code, _, err) = run_trusted(&scratch, &mut terminal, None);
            assert_eq!(code, EXIT_NOT_TRUSTED, "{path}: {err}");
        }
    }

    #[test]
    fn the_no_terminal_message_does_not_send_the_script_to_flow_check_for_the_hash() {
        let scratch = Scratch::new("trust-message");
        scratch.write("plan.yml", VALID);
        let mut terminal = Scripted::new(false, &[]);
        let (_, _, err) = run_trusted(&scratch, &mut terminal, None);
        assert!(!err.contains("flow check"), "{err}");
        assert!(err.contains("konductor flow trust plan"), "{err}");
        assert!(err.contains("KONDUCTOR_TRUST=<hash>"), "{err}");
        assert!(err.contains(".envrc"), "{err}");
    }

    // D-001: tests for `find_project_root`. Each test owns a scratch folder and passes it in; the process cwd is not
    // touched.

    /// A scratch folder tree that is removed when the value is dropped.
    struct ScratchTree(PathBuf);

    impl ScratchTree {
        fn new(label: &str) -> ScratchTree {
            let dir = std::env::temp_dir().join(format!(
                "konductor-flow-root-{label}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&dir).unwrap();
            ScratchTree(dir)
        }

        fn mkdir(&self, relative: &str) -> PathBuf {
            let target = self.0.join(relative);
            fs::create_dir_all(&target).unwrap();
            target
        }
    }

    impl Drop for ScratchTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// A `$HOME` that is not any folder of the scratch tree.
    fn other_home() -> PathBuf {
        PathBuf::from("/nonexistent-home-for-tests")
    }

    #[test]
    fn find_project_root_climbs_to_the_git_top_folder_with_a_konductor_folder() {
        let tree = ScratchTree::new("inside-git");
        let top = tree.mkdir("repo");
        tree.mkdir("repo/.git");
        tree.mkdir("repo/.konductor");
        let nested = tree.mkdir("repo/pkg/src");
        assert_eq!(find_project_root(&nested, Some(&other_home())), Ok(top));
    }

    #[test]
    fn find_project_root_falls_back_to_the_starting_folder_without_a_git_top_folder() {
        let tree = ScratchTree::new("no-git");
        let start = tree.mkdir("here");
        // A `.konductor/` higher up must not pull the resolver up without a `.git` on the walk.
        tree.mkdir(".konductor");
        assert_eq!(
            find_project_root(&start, Some(&other_home())),
            Ok(start.clone())
        );
    }

    #[test]
    fn find_project_root_with_a_git_folder_and_no_konductor_is_the_no_konductor_outcome() {
        let tree = ScratchTree::new("no-konductor");
        tree.mkdir("repo");
        tree.mkdir("repo/.git");
        let nested = tree.mkdir("repo/pkg/src");
        assert_eq!(
            find_project_root(&nested, Some(&other_home())),
            Err(RootError::NoKonductor)
        );
    }

    #[test]
    fn find_project_root_refuses_when_the_git_top_folder_is_home_and_searches_nothing() {
        let tree = ScratchTree::new("git-is-home");
        let home = tree.mkdir("home");
        tree.mkdir("home/.git");
        // A `.konductor/` in the folder a search would reach first: the answer must still be the refusal.
        tree.mkdir("home/work/proj/.konductor");
        let nested = tree.mkdir("home/work/proj/src");
        assert_eq!(
            find_project_root(&nested, Some(&home)),
            Err(RootError::IsHome)
        );
        assert_eq!(
            find_project_root(&home, Some(&home)),
            Err(RootError::IsHome)
        );
    }

    #[test]
    fn find_project_root_refuses_a_working_folder_that_is_home_with_no_git_folder() {
        let tree = ScratchTree::new("cwd-is-home");
        let home = tree.mkdir("home");
        tree.mkdir("home/.konductor");
        assert_eq!(
            find_project_root(&home, Some(&home)),
            Err(RootError::IsHome)
        );
    }

    #[test]
    fn find_project_root_uses_a_folder_under_home_that_has_no_git_folder() {
        let tree = ScratchTree::new("under-home");
        let home = tree.mkdir("home");
        let start = tree.mkdir("home/work");
        assert_eq!(find_project_root(&start, Some(&home)), Ok(start.clone()));
    }

    #[test]
    fn find_project_root_with_an_unset_or_relative_home_is_the_home_unusable_outcome() {
        let tree = ScratchTree::new("home-unusable");
        let start = tree.mkdir("repo");
        tree.mkdir("repo/.git");
        tree.mkdir("repo/.konductor");
        assert_eq!(
            find_project_root(&start, None),
            Err(RootError::HomeUnusable)
        );
        assert_eq!(
            find_project_root(&start, Some(Path::new("relative/home"))),
            Err(RootError::HomeUnusable)
        );
    }

    #[cfg(unix)]
    #[test]
    fn find_project_root_compares_canonical_forms_so_a_linked_home_still_matches() {
        let tree = ScratchTree::new("linked-home");
        let real = tree.mkdir("real");
        tree.mkdir("real/.git");
        tree.mkdir("real/.konductor");
        let link = tree.0.join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert_eq!(
            find_project_root(&real, Some(&link)),
            Err(RootError::IsHome)
        );
    }

    #[test]
    fn root_errors_exit_74_77_and_64_with_their_json_codes() {
        let run = |error: RootError, json: bool| {
            let (mut out, mut err) = (Vec::new(), Vec::new());
            let code = report_root_error(error, json, ColorMode::disabled(), &mut out, &mut err);
            (
                code,
                String::from_utf8(out).unwrap(),
                String::from_utf8(err).unwrap(),
            )
        };
        let (code, out, err) = run(RootError::IsHome, true);
        assert_eq!(code, 77);
        assert!(out.contains("\"code\":\"project_root_is_home\""), "{out}");
        assert!(err.is_empty(), "{err}");
        let (code, _, err) = run(RootError::IsHome, false);
        assert_eq!(code, 77);
        assert!(err.contains("home folder"), "{err}");
        let (code, out, _) = run(RootError::HomeUnusable, true);
        assert_eq!(code, 74);
        assert!(out.contains("\"code\":\"home_unusable\""), "{out}");
        let (code, _, err) = run(RootError::HomeUnusable, false);
        assert_eq!(code, 74);
        assert!(err.contains("HOME is not set to an absolute path"), "{err}");
        let (code, _, err) = run(RootError::NoKonductor, false);
        assert_eq!(code, 64);
        assert!(
            err.contains("no .konductor/ found, run konductor init"),
            "{err}"
        );
    }
}
