// SPDX-License-Identifier: Apache-2.0
//
// view.rs: `konductor flow view <name> [--harness h]`.
//
// It starts the canvas server (`workflow_adapters::canvas`) on the loopback address and prints the launch address on
// one line. Like `flow check` and `flow show` it works on the working folder: no upward search, no `$HOME` needed and
// no exit 64 or 77 for the root. A workflow with errors does not stop the server, so that it can be fixed in the
// Designer. Only a file that is not there is a usage error.
//
// A run that the canvas starts goes through the same checks as `flow run`: the trust gate (without the question), the
// workspace lock, the harness and the runner. The canvas never grants trust. If the workflow needs confirmation and
// there is a terminal, the question is asked here, before the server starts, with the summary `flow trust` shows.
//
// Exit codes: 0 when the server was stopped, 64 for a usage error (a bad name, `library/<name>`, a harness that cannot
// be chosen, a name that matches no file), 74 when the page folder is missing or the port cannot be bound.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use workflow_adapters::canvas::{
    new_secret, CanvasConfig, CanvasError, CanvasServer, RunEntry, StartRefusal, StartRequest,
    StartedRun,
};
use workflow_adapters::process::current_owner;
use workflow_adapters::run_lock::Peek;
use workflow_adapters::{
    config_folders, resolve_harness, FileAgentCatalog, FileRunLock, FileRunStore, FileTrustStore,
    HarnessChoice, InstalledFiles, Script, SimulatedClock, StdTerminal, SystemClock,
    SystemLauncher, NO_TIMEOUT_WARNING,
};
use workflow_core::ports::{RunLock, Terminal, TrustStore};
use workflow_core::runner::{execute, prepare, start, GuardedHarness, StartError, SweepResult};
use workflow_core::trust::{decide, ConfigFile, Verdict};
use workflow_core::{parse_reference, Reference, ReferenceError};

use super::{
    add_claude_mismatches, agent_catalog, assess, build_harness, claude_catalog, config_unchanged,
    confirmed, find, halt_message, repo_key, summary_text, usage_error, Assessment, Context,
    Subject, TrustPorts, EXIT_RECORD,
};
use super::{find_project_root, RootError};
use crate::cli::flow_harness::installed_runners;
use crate::cli::output::{self, ColorMode};

/// The environment variable that names the folder of the built page.
const CANVAS_DIR_ENV: &str = "KONDUCTOR_CANVAS_DIR";
/// How long a live run gets to end its session after the server is told to stop.
const STOP_GRACE: Duration = Duration::from_secs(20);

/// The inputs of `flow view` besides the folders.
pub(super) struct Args {
    pub name: String,
    pub harness: Option<String>,
    pub fake_script: Option<PathBuf>,
    pub fake_script_env: Option<OsString>,
}

/// The folder of the built page: `KONDUCTOR_CANVAS_DIR`, else `dist/` next to this program.
fn page_dir() -> Option<PathBuf> {
    match std::env::var_os(CANVAS_DIR_ENV).filter(|v| !v.is_empty()) {
        Some(dir) => Some(PathBuf::from(dir)),
        None => Some(std::env::current_exe().ok()?.parent()?.join("dist")),
    }
}

/// The first file or folder under `dir`, `dir` included, that every user can write to. Links are not followed, and at
/// most `MAX_SCANNED` entries are looked at.
fn world_writable_under(dir: &Path) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    const MAX_SCANNED: usize = 10_000;
    let mut pending = vec![dir.to_path_buf()];
    let mut seen = 0;
    while let Some(path) = pending.pop() {
        seen += 1;
        let meta = std::fs::symlink_metadata(&path).ok()?;
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.permissions().mode() & 0o002 != 0 {
            return Some(path);
        }
        if meta.is_dir() && seen < MAX_SCANNED {
            pending.extend(std::fs::read_dir(&path).ok()?.flatten().map(|e| e.path()));
        }
    }
    None
}

/// A refusal when the page folder is the `dist/` next to the program and every user can write to it or to a file in
/// it, since they could change the page that runs in the browser with a session token. Only the world-writable bit
/// counts: with a umask of 002 a group-writable folder is the normal result of a build, and the group is the user's
/// own. A folder named by the variable is the user's choice.
fn writable_by_others() -> Option<String> {
    if std::env::var_os(CANVAS_DIR_ENV).is_some_and(|v| !v.is_empty()) {
        return None;
    }
    let dir = page_dir()?;
    let found = world_writable_under(&dir)?;
    Some(format!(
        "The page folder {} holds {}, which can be written by every user, so it is not served. Remove the write \
         permission for others, or set {CANVAS_DIR_ENV}.",
        dir.display(),
        found.display()
    ))
}

/// Whether `program` is an executable file in a folder of `PATH`.
fn on_path(program: &str) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::env::var_os("PATH").is_some_and(|path| {
        std::env::split_paths(&path).any(|dir| {
            std::fs::metadata(dir.join(program))
                .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        })
    })
}

pub(super) fn view(
    args: Args,
    cwd: &Path,
    home: Option<&Path>,
    json: bool,
    color: ColorMode,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    let context = Context {
        cwd,
        project_root: cwd,
        home,
        json,
        color,
    };
    // `library/<name>` is refused before anything is looked up.
    match parse_reference(&args.name) {
        Ok(Reference::Local(_)) => {}
        Ok(Reference::Shipped(_)) => {
            let message = "Shipped workflows (`library/<name>`) are not available yet.";
            return usage_error(message, &context, out, err);
        }
        Err(ReferenceError::InvalidName) => {
            let message = format!("A workflow name {}.", workflow_core::rules::NAME_RULE);
            return usage_error(&message, &context, out, err);
        }
    }
    let choice = match resolve_harness(
        args.harness.as_deref(),
        installed_runners(home),
        args.fake_script.as_deref(),
        args.fake_script_env.as_deref(),
    ) {
        Ok(choice) => choice,
        Err(refusal) => return usage_error(&refusal.to_string(), &context, out, err),
    };
    let script = match &choice {
        HarnessChoice::Fake { script } => match Script::load(script) {
            Ok(script) => Some(script),
            Err(why) => {
                let message = format!("The fake script cannot be used: {why}.");
                return usage_error(&message, &context, out, err);
            }
        },
        _ => {
            // A session starts in the working folder, which a path that is not UTF-8 cannot be given to the
            // launcher as.
            if cwd.to_str().is_none() {
                return usage_error(
                    "The working folder is not valid UTF-8, so a session cannot start in it.",
                    &context,
                    out,
                    err,
                );
            }
            None
        }
    };
    let (name, found, _skipped) = match find(&context, &args.name, out, err) {
        Ok(found) => found,
        Err(code) => return code,
    };
    let checked = workflow_core::check_text(&name, &found.text, &found.source);
    if !checked.is_valid() && !json {
        let _ = writeln!(
            err,
            "note: The workflow has {} error(s). The canvas shows them, and a run is refused until they are fixed.",
            checked.errors()
        );
    }

    if let Some(message) = writable_by_others() {
        return fail(&message, EXIT_RECORD, &context, out, err);
    }
    let Some(page_dir) = page_dir().filter(|dir| dir.join("index.html").is_file()) else {
        let message = format!(
            "The canvas page was not found. Set {CANVAS_DIR_ENV} to the folder of a built page, which \
             `npm run build` in workflow-canvas/ makes as dist/."
        );
        return fail(&message, EXIT_RECORD, &context, out, err);
    };

    // A workflow that is not in a project is refused a run, as `flow run` refuses it, so asking about trust would
    // record nothing that a run could use.
    let not_a_project = not_in_a_project(cwd, home);
    match &not_a_project {
        Some(fix) if !json => {
            let _ = writeln!(
                err,
                "note: {fix} Until then a run from the canvas is refused."
            );
        }
        Some(_) => {}
        None => ask_to_trust(&context, &choice, &name, &checked, &found),
    }

    let Ok(launch_code) = new_secret() else {
        return fail(
            "No random source could be read.",
            EXIT_RECORD,
            &context,
            out,
            err,
        );
    };
    // Set by the first Ctrl+C, terminate signal or hangup. The loop below ends the server on it, and the launcher of a
    // live run ends that run's session on it, as the launcher of `flow run` does.
    let stop = Arc::new(AtomicBool::new(false));
    let entry = ViewEntry {
        interrupt: Arc::clone(&stop),
        cwd: cwd.to_path_buf(),
        home: home.map(Path::to_path_buf),
        choice: choice.clone(),
        script,
        color,
        not_a_project,
    };
    let config = CanvasConfig {
        root: name.clone(),
        source: found.source.clone(),
        scope: found.scope,
        project_root: cwd.to_path_buf(),
        harness: choice.name().to_string(),
        page_dir,
        launch_code,
        entry: Arc::new(entry),
        clock: Arc::new(SystemClock),
    };
    let server = match CanvasServer::start(config) {
        Ok(server) => server,
        Err(CanvasError::Page(why)) => return fail(&why, EXIT_RECORD, &context, out, err),
        Err(CanvasError::Bind(why)) => {
            let message = format!("The canvas server could not start: {why}.");
            return fail(&message, EXIT_RECORD, &context, out, err);
        }
    };
    if let Err(error) = stop_on_signal(&stop) {
        server.stop(Duration::ZERO);
        let message = format!("The signal handlers could not be set: {error}.");
        return fail(&message, EXIT_RECORD, &context, out, err);
    }
    // The only line on standard output. It holds the launch code, and nothing else does.
    let _ = writeln!(out, "{}", server.launch_address());
    let _ = out.flush();
    while !stop.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(50));
    }
    server.stop(STOP_GRACE);
    0
}

fn fail(
    message: &str,
    code: u8,
    context: &Context,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    super::runtime_error(message, context, out, err);
    code
}

/// What the trust rules make of the workflow on this harness, with the agent catalog that the run will use, as
/// `flow run` makes it: the summary, the ambiguity check and the hash all read the files that the harness reads.
fn assess_for(
    context: &Context,
    choice: &HarnessChoice,
    checked: &workflow_core::Checked,
    found: &workflow_adapters::Found,
) -> Assessment {
    let catalog = match choice {
        HarnessChoice::Fake { .. } => agent_catalog(context),
        HarnessChoice::KiroCli => FileAgentCatalog::new(context.project_root, context.home),
        HarnessChoice::Claude => claude_catalog(context),
    };
    let mut assessment = assess(context, checked, found, &catalog);
    if *choice == HarnessChoice::Claude {
        add_claude_mismatches(&mut assessment, checked, &claude_catalog(context), context);
    }
    assessment
}

/// The question of `flow trust`, asked before the server starts, for a workflow that needs it. A no, a missing
/// terminal and a record that cannot be kept leave the workflow untrusted, and the server starts anyway: a run then
/// answers `trust_required`.
fn ask_to_trust(
    context: &Context,
    choice: &HarnessChoice,
    name: &str,
    checked: &workflow_core::Checked,
    found: &workflow_adapters::Found,
) {
    if !checked.is_valid() {
        return;
    }
    let assessment = assess_for(context, choice, checked, found);
    let Some(hash) = assessment.hash.as_deref() else {
        return;
    };
    if !assessment.needed || !assessment.ambiguous_agents.is_empty() {
        return;
    }
    let Ok(key) = repo_key(context) else { return };
    let mut store = FileTrustStore::new(context.home);
    let mut terminal = StdTerminal;
    let recorded = store.recorded(&key, name);
    if !matches!(
        decide(hash, recorded.as_deref(), None),
        Verdict::Unconfirmed
    ) || !terminal.is_available()
        || store.can_record().is_err()
    {
        return;
    }
    let subject = Subject {
        name,
        checked,
        found,
        assessment: &assessment,
    };
    let Some(summary) = summary_text(&subject) else {
        return;
    };
    let mut ports = TrustPorts {
        store: &mut store,
        terminal: &mut terminal,
    };
    if confirmed(&mut ports, &summary, hash) {
        if let Err(error) = ports.store.record(&key, name, hash) {
            let _ = writeln!(
                std::io::stderr(),
                "warning: The trust record was not kept: {}",
                error.0
            );
        }
    }
}

/// What the server calls to start a run: the checks of `flow run`, in the order of the contract.
struct ViewEntry {
    /// Set when the server is told to stop. The launcher of each session watches it.
    interrupt: Arc<AtomicBool>,
    cwd: PathBuf,
    home: Option<PathBuf>,
    choice: HarnessChoice,
    script: Option<Script>,
    color: ColorMode,
    /// Why the workflow cannot be trusted where it is: the fix to show, when the run would be refused as a run of
    /// `flow run` is.
    not_a_project: Option<String>,
}

/// The sentence for the `fix` of a run that is refused because the workflow is not in a project. The root is looked
/// for as `flow run` does, up to the git top folder. With no `.konductor/` at or above the working folder, with no
/// usable `HOME`, or with a root that is the home folder, there is nothing a trust record could be keyed by.
fn not_in_a_project(cwd: &Path, home: Option<&Path>) -> Option<String> {
    match find_project_root(cwd, home) {
        Ok(_) => None,
        Err(RootError::HomeUnusable) => Some(
            "HOME must be set to an absolute path before the workflow can be trusted. Set it and start flow view \
             again."
                .to_string(),
        ),
        Err(RootError::IsHome) => Some(
            "The workflow is in your home folder. Move it into a project, a folder that has a .konductor folder, and \
             start flow view there."
                .to_string(),
        ),
        Err(RootError::NoKonductor) => Some(
            "The workflow must be in a project, a folder that has a .konductor folder. Start flow view there."
                .to_string(),
        ),
    }
}

impl ViewEntry {
    fn context(&self) -> Context<'_> {
        Context {
            cwd: &self.cwd,
            project_root: &self.cwd,
            home: self.home.as_deref(),
            json: false,
            color: self.color,
        }
    }

    /// The program that the harness starts, if it is a real one.
    fn program(&self) -> Option<&'static str> {
        match self.choice {
            HarnessChoice::KiroCli => Some("kiro-cli"),
            HarnessChoice::Claude => Some("claude"),
            HarnessChoice::Fake { .. } => None,
        }
    }
}

impl RunEntry for ViewEntry {
    fn start(&self, request: &StartRequest) -> Result<StartedRun, StartRefusal> {
        if let Some(fix) = &self.not_a_project {
            return Err(StartRefusal::TrustImpossible(fix.clone()));
        }
        let context = self.context();
        // Trust is read again from the files as they are now. The canvas has no way to grant it.
        let assessment = assess_for(&context, &self.choice, request.checked, request.found);
        let Some(hash) = assessment.hash.clone() else {
            return Err(StartRefusal::TrustRequired);
        };
        if !assessment.ambiguous_agents.is_empty() {
            return Err(StartRefusal::TrustRequired);
        }
        if assessment.needed {
            // A repository that cannot be keyed has no record, so nothing in it is trusted.
            let key = repo_key(&context).map_err(|_| StartRefusal::TrustRequired)?;
            let recorded = FileTrustStore::new(context.home).recorded(&key, request.name);
            if !matches!(decide(&hash, recorded.as_deref(), None), Verdict::Trusted) {
                return Err(StartRefusal::TrustRequired);
            }
        }
        match FileRunLock::peek(&self.cwd).map_err(|error| StartRefusal::Storage(error.0))? {
            Peek::Held(record) => {
                return Err(StartRefusal::AlreadyRunning(record.map(|r| r.run_id)))
            }
            Peek::Free => {}
        }
        // `flow run` has no such answer: a program that is missing fails the stage with `SESSION_FAILED`. The canvas
        // contract has `harness_unavailable` for it, so the program is looked for before a run is made.
        if let Some(program) = self.program() {
            if !on_path(program) {
                return Err(StartRefusal::HarnessUnavailable {
                    error: format!("{program} is not installed."),
                    fix: format!("Install {program} and sign in, then try again."),
                });
            }
        }
        let workflow =
            request.checked.workflow.clone().ok_or_else(|| {
                StartRefusal::Storage("the workflow was not resolved".to_string())
            })?;
        let prepared = prepare(workflow, Some(request.goal), &BTreeMap::new())
            .map_err(|error| StartRefusal::BadParams(error.message()))?;
        let mut store =
            FileRunStore::open(&self.cwd).map_err(|error| StartRefusal::Storage(error.0))?;
        let mut lock = FileRunLock::new(&self.cwd);
        let mut launcher = SystemLauncher::new();
        let started = {
            let clock = SimulatedClock::default();
            start(
                &prepared,
                self.choice.name(),
                current_owner(),
                &mut store,
                &mut lock,
                &clock,
                &mut launcher,
            )
        }
        .map_err(|error| match error {
            StartError::AlreadyRunning(holder) => StartRefusal::AlreadyRunning(Some(holder.run_id)),
            StartError::UnreadableLock => StartRefusal::AlreadyRunning(None),
            StartError::Port(error) => StartRefusal::Storage(error.0),
        })?;
        for swept in &started.swept {
            match &swept.result {
                SweepResult::Ended => {
                    let _ = writeln!(
                        std::io::stderr(),
                        "note: Run {} left a session running in process group {}. It was ended.",
                        swept.run_id,
                        swept.group.pgid
                    );
                }
                SweepResult::Failed(why) => {
                    let _ = writeln!(
                        std::io::stderr(),
                        "warning: Run {} left a session running in process group {}, and it could not be ended: {why}",
                        swept.run_id,
                        swept.group.pgid
                    );
                }
                _ => {}
            }
        }
        for ended in &started.recovered {
            let _ = writeln!(
                std::io::stderr(),
                "note: Run {} was left running by process {}, which is gone. It now reads as {}.",
                ended.run_id,
                ended.owner.pid,
                ended.status.as_str()
            );
        }
        for stuck in &started.unrecovered {
            let _ = writeln!(
                std::io::stderr(),
                "warning: Run {} was left running by a process that is gone, but it could not be ended, so it still \
                 reads as running: {}",
                stuck.run_id,
                stuck.error.0
            );
        }
        let run_id = started.run.run_id.clone();
        let (cwd, home) = (self.cwd.clone(), self.home.clone());
        let (choice, script, color) = (self.choice.clone(), self.script.clone(), self.color);
        let interrupt = Arc::clone(&self.interrupt);
        let inputs = request.checked.trust_inputs.clone();
        let (installed, config, needed) =
            (assessment.installed, assessment.config, assessment.needed);
        let name = request.name.to_string();
        let handle = std::thread::spawn(move || {
            run_in_background(
                interrupt,
                started.run,
                &prepared,
                &mut store,
                lock,
                &choice,
                script,
                &cwd,
                home.as_deref(),
                color,
                &name,
                needed,
                &inputs,
                &installed,
                &config,
                &hash,
            );
        });
        Ok(StartedRun { run_id, handle })
    }
}

/// Runs the stages of a started run, as `flow run` does after it has started one. The harness is built here, on the
/// thread that uses it.
#[allow(clippy::too_many_arguments)]
fn run_in_background(
    interrupt: Arc<AtomicBool>,
    mut run: workflow_core::run::Run,
    prepared: &workflow_core::runner::Prepared,
    store: &mut FileRunStore,
    mut lock: FileRunLock,
    choice: &HarnessChoice,
    script: Option<Script>,
    cwd: &Path,
    home: Option<&Path>,
    color: ColorMode,
    name: &str,
    needed: bool,
    inputs: &workflow_core::trust::TrustInputs,
    installed: &InstalledFiles,
    confirmed_files: &[ConfigFile],
    confirmed_hash: &str,
) {
    let clock = Rc::new(SimulatedClock::default());
    let mut launcher = SystemLauncher::new().with_interrupt(interrupt);
    // Without `timeout` the stage limit lasts only while this process does, as `flow run` says before its first session.
    if matches!(choice, HarnessChoice::KiroCli) && !launcher.guards_limit() {
        let _ = writeln!(std::io::stderr(), "warning: {NO_TIMEOUT_WARNING}");
    }
    let kiro_catalog = FileAgentCatalog::new(cwd, home);
    let claude_catalog = FileAgentCatalog::new(cwd, home)
        .with_folders_above(config_folders(cwd, home).get(1..).unwrap_or_default());
    let mut inner = build_harness(
        choice,
        script,
        &clock,
        &mut launcher,
        &kiro_catalog,
        &claude_catalog,
        cwd,
        color,
    );
    // The runner reads the tool configuration files again before each session, as `flow run` does.
    let context = Context {
        cwd,
        project_root: cwd,
        home,
        json: false,
        color,
    };
    let unchanged =
        || config_unchanged(&context, installed, inputs, confirmed_files, confirmed_hash);
    let mut harness = GuardedHarness::new(&mut *inner, &unchanged);
    if let Err(error) = execute(
        &mut run,
        prepared,
        &mut harness,
        &*clock,
        store,
        &mut |_| {},
    ) {
        // The run reads `halted` on the next start, which takes the lock this run gives back.
        let prefix = output::error_prefix(color, "konductor flow:");
        let _ = writeln!(
            std::io::stderr(),
            "{prefix} The run state could not be written: {}",
            error.0
        );
    }
    lock.release();
    if let Some(stage) = harness.refused_stage().map(str::to_string) {
        let prefix = output::error_prefix(color, "konductor flow:");
        let found = harness.refused_cause().unwrap_or_default();
        let message = halt_message(needed, &stage, found, name);
        let _ = writeln!(std::io::stderr(), "{prefix} {message}");
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Signals

/// Makes Ctrl+C, the terminate signal and a closed terminal set `stop`, so that the server ends cleanly instead of the
/// process. A second signal runs the default action, so it ends the process while the first is still waiting for a
/// session to end. The conditional action goes first: it reads the flag before the first signal sets it.
fn stop_on_signal(stop: &Arc<AtomicBool>) -> std::io::Result<()> {
    use signal_hook::consts::{SIGHUP, SIGINT, SIGTERM};
    use signal_hook::flag;
    for signal in [SIGINT, SIGTERM, SIGHUP] {
        flag::register_conditional_default(signal, Arc::clone(stop))?;
        flag::register(signal, Arc::clone(stop))?;
    }
    Ok(())
}
