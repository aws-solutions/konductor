// SPDX-License-Identifier: Apache-2.0
//! The canvas server: the HTTP adapter that answers the six operations of `workflow-canvas/api/openapi.yaml` from the
//! engine, and serves the built page.
//!
//! It adds no port to the core. It binds the loopback address only, whatever the caller asks, checks the `Host` and
//! `Origin` of every request, and needs the session token on every call but the one that makes it. A caller that holds
//! the launch code gets the token once, within 60 seconds.
//!
//! What starts a run is not here: the command that starts the server passes a [`RunEntry`], which is the entry that
//! `flow run` uses (trust, the lock, the harness). This module reads the saved file and checks it, calls the entry, and
//! keeps the thread that the run goes on in.
//!
//! The transport is the standard library's `TcpListener`, one thread for each connection and at most 32 open at once.
//! A small reader and writer in [`http`] handle the part of HTTP/1.1 that the contract uses. To use another transport,
//! swap [`http`] and [`server`] and keep the functions of [`api`].

mod api;
mod guards;
mod http;
mod pages;
mod server;

use std::net::{Ipv4Addr, SocketAddr, TcpListener};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use workflow_core::ports::{Clock, RunStore};
use workflow_core::run::{Run, RunStatus};
use workflow_core::runner::sweep_session;
use workflow_core::Checked;

use crate::file_source::FileSource;
use crate::launcher::SystemLauncher;
use crate::lookup::{Found, Scope};
use crate::run_store::FileRunStore;

pub use guards::{new_secret, same_secret, LAUNCH_WINDOW_MS};
pub use http::{MAX_BODY_BYTES, MAX_HEADERS, MAX_HEAD_BYTES, MAX_REQUEST_LINE, READ_TIMEOUT};
pub use server::MAX_CONNECTIONS;

/// What the server hands the entry to start a run: the saved workflow, checked with no errors, and the goal.
pub struct StartRequest<'a> {
    pub name: &'a str,
    pub checked: &'a Checked,
    pub found: &'a Found,
    pub goal: &'a str,
}

/// A run that started. The run goes on in `handle`'s thread.
pub struct StartedRun {
    pub run_id: String,
    pub handle: JoinHandle<()>,
}

/// Why the entry did not start a run. The server maps each to the contract's error and adds the command to `fix`.
#[derive(Debug)]
pub enum StartRefusal {
    TrustRequired,
    /// The workflow cannot be trusted where it is, and no command helps. The text says what to do instead, for the
    /// `fix` of the answer.
    TrustImpossible(String),
    /// Another run holds the workspace lock. `Some` is its run, when its record could be read.
    AlreadyRunning(Option<String>),
    HarnessUnavailable {
        error: String,
        fix: String,
    },
    /// The run state could not be written. The text is for standard error and never for the client.
    Storage(String),
}

/// What `flow run` does to start a run, as the server calls it. The checks are in the order of the contract: trust,
/// an active run, the harness. A run that starts holds the workspace lock until its thread ends.
pub trait RunEntry: Send + Sync {
    fn start(&self, request: &StartRequest) -> Result<StartedRun, StartRefusal>;
}

/// What a server needs.
pub struct CanvasConfig {
    /// The workflow the session opens. Only this one can be loaded, saved, checked and run.
    pub root: String,
    /// The folder of workflows that holds it, and the scope that folder stands for.
    pub source: FileSource,
    pub scope: Scope,
    /// The folder with `.konductor/`, where the run state is kept.
    pub project_root: PathBuf,
    /// The harness that runs use. The session reports it.
    pub harness: String,
    /// The folder of the built page.
    pub page_dir: PathBuf,
    pub launch_code: String,
    pub entry: Arc<dyn RunEntry>,
    pub clock: Arc<dyn Clock + Send + Sync>,
}

/// Why a server did not start.
#[derive(Debug)]
pub enum CanvasError {
    /// The page folder has no `index.html`.
    Page(String),
    /// The port could not be bound.
    Bind(std::io::Error),
}

pub(crate) struct Active {
    pub run_id: String,
    pub handle: JoinHandle<()>,
}

pub struct Shared {
    pub(crate) config: CanvasConfig,
    pub(crate) port: u16,
    pub(crate) pages: pages::Pages,
    pub(crate) gate: Mutex<guards::SessionGate>,
    /// One save at a time.
    pub(crate) saves: Mutex<()>,
    /// One start at a time, and no start while a reader looks at the lock.
    pub(crate) starts: Mutex<()>,
    pub(crate) active: Mutex<Option<Active>>,
    pub(crate) stopping: AtomicBool,
}

/// A running canvas server.
pub struct CanvasServer {
    shared: Arc<Shared>,
    accept: Option<JoinHandle<()>>,
}

impl CanvasServer {
    /// Binds `127.0.0.1` on a port the system picks and starts answering. The launch window opens now, so the caller
    /// prints [`CanvasServer::launch_address`] at once.
    pub fn start(config: CanvasConfig) -> Result<CanvasServer, CanvasError> {
        let pages = pages::Pages::open(config.page_dir.clone()).map_err(CanvasError::Page)?;
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
            .map_err(CanvasError::Bind)?;
        listener.set_nonblocking(true).map_err(CanvasError::Bind)?;
        let port = listener.local_addr().map_err(CanvasError::Bind)?.port();
        let gate = guards::SessionGate::new(config.launch_code.clone(), config.clock.now_ms());
        let shared = Arc::new(Shared {
            config,
            port,
            pages,
            gate: Mutex::new(gate),
            saves: Mutex::new(()),
            starts: Mutex::new(()),
            active: Mutex::new(None),
            stopping: AtomicBool::new(false),
        });
        let accept = {
            let shared = Arc::clone(&shared);
            std::thread::Builder::new()
                .name("canvas-accept".to_string())
                .spawn(move || server::accept_loop(shared, listener))
                .map_err(CanvasError::Bind)?
        };
        Ok(CanvasServer {
            shared,
            accept: Some(accept),
        })
    }

    pub fn port(&self) -> u16 {
        self.shared.port
    }

    /// `http://127.0.0.1:<port>/#<code>`. The code is in the fragment, which a browser never sends to a server.
    pub fn launch_address(&self) -> String {
        format!(
            "http://127.0.0.1:{}/#{}",
            self.shared.port, self.shared.config.launch_code
        )
    }

    /// Stops answering, ends the sessions of a run that is live with their process group, and waits for its thread,
    /// so the run reads `halted` and the lock is given back. The session is ended again on every tick until the run's
    /// thread is done, because the runner clears the recorded group between two stages and a session that starts in
    /// that gap would otherwise run on. A `grace` that runs out leaves the thread, and the next run in the workspace
    /// ends what is left (D24).
    pub fn stop(mut self, grace: Duration) {
        self.shared.stopping.store(true, Ordering::SeqCst);
        if let Some(accept) = self.accept.take() {
            let _ = accept.join();
        }
        // A start that is under way finishes first, and a later one is refused, so no run begins after this point.
        let active = {
            let _no_start = self
                .shared
                .starts
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            self.shared
                .active
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take()
        };
        let Some(active) = active else { return };
        let until = Instant::now() + grace;
        while !active.handle.is_finished() && Instant::now() < until {
            end_live_session(&self.shared.config.project_root, &active.run_id);
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

/// Ends the process group that the live run recorded for its session, so that the run's own thread sees the session
/// end and halts the run.
fn end_live_session(project_root: &std::path::Path, run_id: &str) {
    let Ok(Some(store)) = FileRunStore::existing(project_root) else {
        return;
    };
    let Ok(Some(text)) = store.read_state(run_id) else {
        return;
    };
    let Some(run) = Run::from_text(&text) else {
        return;
    };
    if run.status != RunStatus::Running {
        return;
    }
    if let Some(group) = run.session_group {
        // The group is ended only if its leader has the recorded start time, as the sweep of a new run does.
        let _ = sweep_session(&group, &mut SystemLauncher::new());
    }
}

impl Drop for CanvasServer {
    fn drop(&mut self) {
        // A server that is dropped without `stop` still stops answering.
        self.shared.stopping.store(true, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::SystemClock;
    use std::sync::atomic::AtomicUsize;
    use workflow_core::json;

    /// An entry that counts the starts it is asked for and starts none.
    struct Counting(AtomicUsize);

    impl RunEntry for Counting {
        fn start(&self, _: &StartRequest) -> Result<StartedRun, StartRefusal> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err(StartRefusal::Storage(
                "a test entry starts nothing".to_string(),
            ))
        }
    }

    const WORKFLOW: &str = "format: konductor/1\nname: hello\nversion: 0.1.0\nintent:\n  outcome: Say hello\nstages:\n  - name: write\n    agent: k-developer\n";

    fn server(label: &str) -> (CanvasServer, Arc<Counting>, PathBuf) {
        let dir = std::env::temp_dir().join(format!("canvas-mod-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("project/.konductor/workflows")).unwrap();
        std::fs::create_dir_all(dir.join("page")).unwrap();
        std::fs::write(dir.join("page/index.html"), "<html></html>").unwrap();
        std::fs::write(dir.join("project/.konductor/workflows/hello.yml"), WORKFLOW).unwrap();
        let entry = Arc::new(Counting(AtomicUsize::new(0)));
        let server = CanvasServer::start(CanvasConfig {
            root: "hello".to_string(),
            source: FileSource::under(&dir.join("project")),
            scope: Scope::Project,
            project_root: dir.join("project"),
            harness: "fake".to_string(),
            page_dir: dir.join("page"),
            launch_code: "code".to_string(),
            entry: entry.clone(),
            clock: Arc::new(SystemClock),
        })
        .unwrap();
        (server, entry, dir)
    }

    fn run_body() -> json::Json {
        json::parse("{\"params\":{\"goal\":\"x\"}}").unwrap()
    }

    #[test]
    fn a_server_that_is_stopping_starts_no_run() {
        let (server, entry, dir) = server("stopping");
        let shared = Arc::clone(&server.shared);
        shared.stopping.store(true, Ordering::SeqCst);
        let refused = api::start_run(&shared, &run_body()).err().expect("refused");
        assert_eq!(refused.code, "io_error");
        assert_eq!(
            entry.0.load(Ordering::SeqCst),
            0,
            "the entry was never asked"
        );
        drop(server);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_start_that_waits_for_the_lock_while_the_server_stops_is_refused() {
        let (server, entry, dir) = server("waiting");
        let shared = Arc::clone(&server.shared);
        let held = shared.starts.lock().unwrap();
        let waiting = {
            let shared = Arc::clone(&shared);
            std::thread::spawn(move || api::start_run(&shared, &run_body()).err().map(|e| e.code))
        };
        // The start is queued on the lock. The server begins to stop, and then the lock is given up.
        std::thread::sleep(Duration::from_millis(200));
        shared.stopping.store(true, Ordering::SeqCst);
        drop(held);
        assert_eq!(waiting.join().unwrap(), Some("io_error"));
        assert_eq!(entry.0.load(Ordering::SeqCst), 0);
        server.stop(Duration::from_secs(1));
        let _ = std::fs::remove_dir_all(dir);
    }
}
