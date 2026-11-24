// SPDX-License-Identifier: Apache-2.0
//! The operations of the canvas contract that this server serves. Each is a function of the shared state and the decoded
//! request, and gives a [`Reply`] or the [`ApiError`] to answer with. Each makes its checks in the order the contract
//! fixes. Nothing here reads a socket, so a test can call them without one.

use std::io::Write;

use workflow_core::json::Json;
use workflow_core::limits::{
    MAX_FILE_BYTES, MAX_GOAL_CHARS, MAX_OUTCOME_CHARS, MAX_PROMPT_CHARS, MAX_STAGES,
};
use workflow_core::ports::{Claim, Clock, LockRecord, PortError, RunLock, RunStore};
use workflow_core::rules::{code_points, decode_file, is_name};
use workflow_core::run::{Run, RunStatus};
use workflow_core::runner::recover;
use workflow_core::time::is_run_id;
use workflow_core::trust::sha256_hex;
use workflow_core::view::{check_response, checked_view, diagnostics_json, stage_fields};
use workflow_core::{check_text, Checked};

use crate::clock::SystemClock;
use crate::file_source::{Skip, WriteError};
use crate::launcher::SystemLauncher;
use crate::lookup::Found;
use crate::process::current_owner;
use crate::run_lock::FileRunLock;
use crate::run_store::FileRunStore;

use super::{Active, Shared, StartRefusal, StartRequest};

/// A refusal, with the status and fields that go with its code.
#[derive(Debug)]
pub struct ApiError {
    pub status: u16,
    pub code: &'static str,
    pub message: String,
    pub extra: Vec<(&'static str, Json)>,
    pub allow: Option<&'static str>,
}

impl ApiError {
    /// The error for `code`, with the status and the sentence that the contract's examples give it.
    pub fn new(code: &'static str) -> ApiError {
        let (status, message) = match code {
            "bad_request" => (400, "The request body is not valid."),
            "bad_name" => (400, "The workflow name is not valid."),
            "bad_hash" => (400, "base_hash must be 64 hex digits or null."),
            "unauthorized" => (401, "The session token is missing or wrong."),
            "invalid_code" => (401, "The launch code is not valid."),
            "forbidden_host" => (403, "The Host header does not match this server."),
            "forbidden_origin" => (403, "The Origin header does not match this server."),
            "read_only_workflow" => (403, "This workflow is read-only."),
            "not_found" => (404, "There is no such path."),
            "method_not_allowed" => (405, "This path does not accept that method."),
            "conflict" => (409, "The file changed on disk."),
            "already_running" => (409, "A run is already active in this workspace."),
            "harness_unavailable" => (409, "The harness is not available."),
            "trust_required" => (409, "The workflow is not trusted yet."),
            "too_large" => (413, "The request body is too large."),
            "invalid_workflow" => (422, "The workflow has errors."),
            "bad_params" => (422, "The run needs a goal."),
            _ => (500, "The server could not read or write its files."),
        };
        ApiError {
            status,
            code,
            message: message.to_string(),
            extra: Vec::new(),
            allow: None,
        }
    }

    pub fn message(mut self, message: impl Into<String>) -> ApiError {
        self.message = message.into();
        self
    }

    fn with(mut self, key: &'static str, value: Json) -> ApiError {
        self.extra.push((key, value));
        self
    }

    /// The body of the response.
    pub fn body(&self) -> Json {
        let mut body = Json::object();
        body.insert("error", Json::str(&self.message));
        body.insert("code", Json::str(self.code));
        for (key, value) in &self.extra {
            body.insert(key, value.clone());
        }
        body
    }
}

/// A success: the status and the JSON body.
pub struct Reply {
    pub status: u16,
    pub body: Json,
}

fn ok(body: Json) -> Result<Reply, ApiError> {
    Ok(Reply { status: 200, body })
}

/// A failure of the server's own storage. The client gets the fixed sentence of the contract, and the cause goes to
/// standard error with the path it names, so that whoever started the server can see what failed.
fn io_error(cause: impl std::fmt::Debug) -> ApiError {
    let _ = writeln!(
        std::io::stderr(),
        "konductor flow view: storage error: {cause:?}"
    );
    ApiError::new("io_error")
}

/// What a request body decoded to, before an operation reads its fields.
pub type Body = Json;

fn text_of(body: &Json, key: &str) -> Result<Option<String>, ApiError> {
    match body.get(key) {
        None => Ok(None),
        Some(Json::Str(text)) => Ok(Some(text.clone())),
        Some(_) => Err(ApiError::new("bad_request")),
    }
}

/// The body must be an object with no field outside `allowed`.
fn only_fields(body: &Json, allowed: &[&str]) -> Result<(), ApiError> {
    match body {
        Json::Object(map) if map.keys().all(|k| allowed.contains(&k.as_str())) => Ok(()),
        _ => Err(ApiError::new("bad_request")),
    }
}

/// A `name` that is left out is the root. One that is not a name is `bad_name`.
fn name_or_root(shared: &Shared, name: Option<String>) -> Result<String, ApiError> {
    match name {
        None => Ok(shared.config.root.clone()),
        Some(name) if is_name(&name) => Ok(name),
        Some(_) => Err(ApiError::new("bad_name")),
    }
}

fn writable_name(shared: &Shared, name: Option<String>) -> Result<String, ApiError> {
    let target = name_or_root(shared, name)?;
    if target == shared.config.root {
        Ok(target)
    } else {
        // The wording of the contract's example: a name other than the root is a page that shows a stale root.
        Err(ApiError::new("read_only_workflow").message(
            "The session root changed. Reload the page before saving, checking, or running.",
        ))
    }
}

/// The root file as it is on disk.
enum RootFile {
    Missing,
    There { bytes: Vec<u8>, text: String },
}

/// Reads the root file. A link, a directory, an oversize file and one that is not UTF-8 are 404, as the contract's
/// "The file" says, and nothing is read through them.
fn read_root(shared: &Shared) -> Result<RootFile, ApiError> {
    match shared.config.source.try_workflow_bytes(&shared.config.root) {
        Ok(None) => Ok(RootFile::Missing),
        Ok(Some(bytes)) => match decode_file(bytes.clone()) {
            Some(text) => Ok(RootFile::There { bytes, text }),
            None => Err(unusable_file()),
        },
        Err(Skip::Unreadable) => Err(io_error("the workflow file could not be read")),
        Err(_) => Err(unusable_file()),
    }
}

fn unusable_file() -> ApiError {
    ApiError::new("not_found").message("The workflow file cannot be used.")
}

fn check(shared: &Shared, name: &str, text: &str) -> Checked {
    check_text(name, text, &shared.config.source)
}

/// `getWorkflow`. `names` are the values of the `name` query parameter.
pub fn get_workflow(shared: &Shared, names: &[String]) -> Result<Reply, ApiError> {
    if names.len() > 1 {
        return Err(ApiError::new("bad_name"));
    }
    let target = name_or_root(shared, names.first().cloned())?;
    if target != shared.config.root {
        return Err(ApiError::new("not_found").message("There is no workflow with this name."));
    }
    let mut doc = Json::object();
    doc.insert("name", Json::str(&target));
    doc.insert("read_only", Json::Bool(false));
    // The same for every text, so a client has it when `view` is null too.
    doc.insert("stage_fields", stage_fields());
    match read_root(shared)? {
        RootFile::Missing => {
            doc.insert("text", Json::Null);
            doc.insert("hash", Json::Null);
            doc.insert("view", Json::Null);
            doc.insert("diagnostics", Json::Array(Vec::new()));
        }
        RootFile::There { bytes, text } => {
            let checked = check(shared, &target, &text);
            doc.insert("hash", Json::str(&sha256_hex(&bytes)));
            doc.insert("view", checked_view(&checked, &text));
            doc.insert("diagnostics", diagnostics_json(&checked.diagnostics));
            doc.insert("text", Json::Str(text));
        }
    }
    ok(doc)
}

fn too_large_text(text: &str) -> Result<(), ApiError> {
    if text.len() > MAX_FILE_BYTES {
        return Err(ApiError::new("too_large").message("The workflow text is too large."));
    }
    Ok(())
}

fn invalid(checked: &Checked) -> ApiError {
    ApiError::new("invalid_workflow").with("diagnostics", diagnostics_json(&checked.diagnostics))
}

fn is_hash(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// `checkWorkflow`.
pub fn check_workflow(shared: &Shared, body: &Body) -> Result<Reply, ApiError> {
    only_fields(body, &["name", "text"])?;
    let text = text_of(body, "text")?.ok_or_else(|| ApiError::new("bad_request"))?;
    let name = text_of(body, "name")?;
    let target = writable_name(shared, name)?;
    too_large_text(&text)?;
    ok(check_response(&check(shared, &target, &text), &text))
}

/// `saveWorkflow`. Saves are one at a time, so the check of `base_hash` and the write are one step with respect to
/// any other save.
pub fn save_workflow(shared: &Shared, body: &Body) -> Result<Reply, ApiError> {
    only_fields(body, &["name", "text", "base_hash"])?;
    let text = text_of(body, "text")?.ok_or_else(|| ApiError::new("bad_request"))?;
    let base_hash = match body.get("base_hash") {
        Some(Json::Null) => None,
        Some(Json::Str(hash)) => Some(hash.clone()),
        _ => return Err(ApiError::new("bad_request")),
    };
    let target = writable_name(shared, text_of(body, "name")?)?;
    if base_hash.as_deref().is_some_and(|h| !is_hash(h)) {
        return Err(ApiError::new("bad_hash"));
    }
    too_large_text(&text)?;
    let checked = check(shared, &target, &text);
    if !checked.is_valid() {
        return Err(invalid(&checked));
    }
    let _one_save = shared
        .saves
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let current = match read_root(shared)? {
        RootFile::Missing => None,
        RootFile::There { bytes, .. } => Some(bytes),
    };
    let conflict = |current: Option<&Vec<u8>>| {
        let error = ApiError::new("conflict");
        match current {
            Some(bytes) => error.with("current_hash", Json::str(&sha256_hex(bytes))),
            None => error.message("The file no longer exists."),
        }
    };
    let source = &shared.config.source;
    match (&base_hash, &current) {
        (None, Some(bytes)) => {
            return Err(conflict(Some(bytes)).message("The file already exists."))
        }
        (Some(_), None) => return Err(conflict(None)),
        (Some(base), Some(bytes)) if sha256_hex(bytes) != *base => {
            return Err(conflict(Some(bytes)))
        }
        // The same bytes: nothing to write.
        (Some(_), Some(bytes)) if bytes == text.as_bytes() => {}
        (None, None) => match source.write_workflow(&target, text.as_bytes(), true) {
            Ok(()) => {}
            Err(WriteError::Exists) => {
                return Err(match read_root(shared) {
                    Ok(RootFile::There { bytes, .. }) => {
                        conflict(Some(&bytes)).message("The file already exists.")
                    }
                    _ => ApiError::new("io_error"),
                })
            }
            Err(WriteError::Other(why)) => return Err(io_error(why)),
        },
        (Some(_), Some(_)) => source
            .write_workflow(&target, text.as_bytes(), false)
            .map_err(io_error)?,
    }
    let mut saved = Json::object();
    saved.insert("hash", Json::str(&sha256_hex(text.as_bytes())));
    saved.insert("view", checked_view(&checked, &text));
    saved.insert("diagnostics", Json::Array(Vec::new()));
    ok(saved)
}

/// The goal of a run, from a body of the form `{"params": {"goal": "..."}}`.
fn read_goal(body: &Body) -> Result<String, ApiError> {
    only_fields(body, &["name", "params"])?;
    let Some(params) = body.get("params") else {
        return Err(ApiError::new("bad_request"));
    };
    let Json::Object(map) = params else {
        return Err(ApiError::new("bad_request"));
    };
    let bad = |message: &'static str| ApiError::new("bad_params").message(message);
    if map.keys().any(|k| k != "goal") {
        return Err(bad("Only a goal is allowed."));
    }
    let goal = match map.get("goal") {
        None => return Err(bad("The run needs a goal.")),
        Some(Json::Str(goal)) => goal,
        Some(_) => return Err(ApiError::new("bad_request")),
    };
    if goal.trim().is_empty() {
        return Err(bad("The run needs a goal."));
    }
    if code_points(goal) > MAX_GOAL_CHARS {
        return Err(bad("The goal is longer than 2048 characters."));
    }
    Ok(goal.clone())
}

/// `startRun`: the file, the workflow, trust, an active run, the harness, in that order.
pub fn start_run(shared: &Shared, body: &Body) -> Result<Reply, ApiError> {
    let goal = read_goal(body)?;
    // After the body: a malformed `name` is `bad_name`, and a name other than the root is `read_only_workflow`.
    writable_name(shared, text_of(body, "name")?)?;
    let root = &shared.config.root;
    let text = match read_root(shared)? {
        RootFile::Missing => {
            return Err(ApiError::new("not_found").message("The workflow has not been saved yet."))
        }
        RootFile::There { text, .. } => text,
    };
    let checked = check(shared, root, &text);
    if !checked.is_valid() {
        return Err(invalid(&checked));
    }
    let found = Found {
        scope: shared.config.scope,
        text,
        source: shared.config.source.clone(),
    };
    // One start at a time, so that two calls cannot both pass the check of the lock before either holds it.
    let _one_start = shared
        .starts
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    // A server that is stopping starts nothing: its run would outlive the shutdown. `stop` takes the same lock before
    // it looks for a live run, so a start either finishes before that or is refused here.
    if shared.stopping.load(std::sync::atomic::Ordering::SeqCst) {
        return Err(io_error("a run was refused because the server is stopping"));
    }
    let request = StartRequest {
        name: root,
        checked: &checked,
        found: &found,
        goal: &goal,
    };
    match shared.config.entry.start(&request) {
        Ok(started) => {
            let run_id = started.run_id.clone();
            *shared
                .active
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Active {
                run_id: started.run_id,
                handle: started.handle,
            });
            let mut body = Json::object();
            body.insert("run_id", Json::str(&run_id));
            Ok(Reply { status: 202, body })
        }
        Err(StartRefusal::TrustImpossible(fix)) => {
            Err(ApiError::new("trust_required").with("fix", Json::Str(fix)))
        }
        Err(StartRefusal::TrustRequired) => Err(ApiError::new("trust_required").with(
            "fix",
            Json::Str(format!(
                "Run `konductor flow trust {root}` in a terminal, then try again."
            )),
        )),
        Err(StartRefusal::AlreadyRunning(run_id)) => {
            let error = ApiError::new("already_running");
            Err(match run_id {
                Some(id) => error.with("run_id", Json::Str(id)),
                None => error,
            })
        }
        Err(StartRefusal::HarnessUnavailable { error, fix }) => {
            Err(ApiError::new("harness_unavailable")
                .message(error)
                .with("fix", Json::Str(fix)))
        }
        Err(StartRefusal::BadParams(message)) => Err(ApiError::new("bad_params").message(message)),
        Err(StartRefusal::Storage(why)) => Err(io_error(why)),
    }
}

/// The contract's `Run`: the fields of the state document that it names, and no others, so the owner's process id and
/// a session's process group stay on disk.
fn run_json(run: &Run) -> Json {
    let state = run.to_json();
    let mut out = Json::object();
    for key in [
        "run_id",
        "workflow",
        "harness",
        "status",
        "started_at",
        "finished_at",
        "exit_code",
        "order",
        "stages",
    ] {
        if let Some(value) = state.get(key) {
            out.insert(key, value.clone());
        }
    }
    // The contract requires `checks`. The engine refuses check keys until slice 3a, so no workflow declares a check and
    // the empty map is the true answer.
    out.insert("checks", Json::object());
    out
}

fn read_run(store: &FileRunStore, run_id: &str) -> Result<Option<Run>, PortError> {
    if !store.list()?.iter().any(|id| id == run_id) {
        return Ok(None);
    }
    Ok(store
        .read_state(run_id)?
        .and_then(|text| Run::from_text(&text)))
}

/// `getRun`, a reader under the dead-owner rule. A run that says `running` is looked at under the workspace lock:
/// a lock that is held means its owner lives, and the state is read as it is. A lock that is free means the owner is
/// gone. The reader then holds the lock, reads the state again and ends the run only if it still says `running`.
pub fn get_run(shared: &Shared, run_id: &str) -> Result<Reply, ApiError> {
    let missing = || ApiError::new("not_found").message("There is no run with this id.");
    if !is_run_id(run_id) {
        return Err(missing());
    }
    let root = &shared.config.project_root;
    let Some(mut store) = FileRunStore::existing(root).map_err(io_error)? else {
        return Err(missing());
    };
    let run = read_run(&store, run_id)
        .map_err(io_error)?
        .ok_or_else(missing)?;
    if run.status != RunStatus::Running {
        return ok(wrap(&run));
    }
    // A start takes the lock for a moment too, and a reader must not make it think another run is active.
    let _quiet = shared
        .starts
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut lock = FileRunLock::new(root);
    let record = LockRecord {
        owner: current_owner(),
        run_id: run_id.to_string(),
    };
    match lock.try_claim(&record).map_err(io_error)? {
        Claim::Held(_) => ok(wrap(&run)),
        Claim::Acquired => {
            let now = SystemClock.now_ms();
            let result = recover(&mut store, "", now, &mut SystemLauncher::new());
            lock.release();
            result.map_err(io_error)?;
            let after = read_run(&store, run_id)
                .map_err(io_error)?
                .ok_or_else(missing)?;
            ok(wrap(&after))
        }
    }
}

fn wrap(run: &Run) -> Json {
    let mut body = Json::object();
    body.insert("run", run_json(run));
    body
}

/// The specialist agents of Konductor that a stage may name, in the order of their ids, each with the line the contract
/// gives it. This version does not look up whether an agent exists, so the list is fixed and does not read the agent
/// catalog, which finds one agent by its id. An orchestrator is not listed, because a stage cannot use one.
const AGENTS: [(&str, &str); 8] = [
    ("k-architect", "System designs, API specs and data models"),
    ("k-browser", "Browser automation with Playwright"),
    ("k-developer", "Backend and frontend code, code review"),
    ("k-media-analyzer", "PDFs, images and diagrams"),
    ("k-product-manager", "User stories and requirements"),
    ("k-quality-assurance", "Test coverage and test strategy"),
    ("k-researcher", "External docs, web and AWS documentation"),
    ("k-tpm", "Program plans and status reports"),
];

/// `listAgents`.
pub fn list_agents() -> Result<Reply, ApiError> {
    let agents = AGENTS
        .iter()
        .map(|(id, summary)| {
            let mut agent = Json::object();
            agent.insert("id", Json::str(id));
            agent.insert("summary", Json::str(summary));
            agent
        })
        .collect();
    let mut body = Json::object();
    body.insert("agents", Json::Array(agents));
    ok(body)
}

/// The limits that the session reports, by their names in the contract. They are the constants that the checker and the
/// run start enforce, so a client reads what the server holds a workflow and a run to.
fn limits_json() -> Json {
    let mut limits = Json::object();
    limits.insert("text_bytes", Json::number(MAX_FILE_BYTES));
    limits.insert("stages", Json::number(MAX_STAGES));
    limits.insert("outcome_chars", Json::number(MAX_OUTCOME_CHARS));
    limits.insert("prompt_chars", Json::number(MAX_PROMPT_CHARS));
    limits.insert("goal_chars", Json::number(MAX_GOAL_CHARS));
    limits
}

/// `createSession`.
pub fn create_session(shared: &Shared, body: &Body) -> Result<Reply, ApiError> {
    only_fields(body, &["code"])?;
    let code = text_of(body, "code")?.ok_or_else(|| ApiError::new("bad_request"))?;
    let length = code_points(&code);
    if !(1..=256).contains(&length) {
        return Err(ApiError::new("bad_request"));
    }
    let now = shared.config.clock.now_ms();
    let token = shared
        .gate
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .exchange(&code, now, || super::guards::new_secret().ok())
        .ok_or_else(|| ApiError::new("invalid_code"))?;
    let mut session = Json::object();
    session.insert("token", Json::Str(token));
    session.insert("root", Json::str(&shared.config.root));
    session.insert("harness", Json::str(&shared.config.harness));
    session.insert("api_version", Json::number(1));
    session.insert(
        "konductor_version",
        Json::str(&shared.config.konductor_version),
    );
    session.insert(
        "capabilities",
        Json::Array(
            super::server::OPERATIONS
                .iter()
                .map(|id| Json::str(id))
                .collect(),
        ),
    );
    session.insert("limits", limits_json());
    ok(session)
}
