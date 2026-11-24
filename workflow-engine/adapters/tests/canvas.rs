// SPDX-License-Identifier: Apache-2.0
//! The canvas server on a loopback port, with the fake harness and a temporary project. A test here can start a
//! process (the holder of a lock), so every test runs one at a time.

mod common;

use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use common::TempDir;
use workflow_adapters::canvas::{
    CanvasConfig, CanvasServer, RunEntry, StartRefusal, StartRequest, StartedRun,
};
use workflow_adapters::fake_harness::Entry;
use workflow_adapters::process::current_owner;
use workflow_adapters::run_lock::Peek;
use workflow_adapters::{
    FakeHarness, FileRunLock, FileRunStore, FileSource, FileTrustStore, Scope, Script,
    SimulatedClock, SystemClock, SystemLauncher,
};
use workflow_core::json::{self, Json};
use workflow_core::ports::{
    GroupState, Harness, Launch, LaunchEnd, LockRecord, Owner, ProcessGroup, ProcessLauncher,
    RunLock, RunStore, Session, SessionEnd, SessionOutcome, TrustStore,
};
use workflow_core::run::{Run, RunStatus, StageState, StageStatus};
use workflow_core::runner::{execute, prepare, start};
use workflow_core::trust::{decide, sha256_hex, Verdict};

const CODE: &str = "test-launch-code";
const SUCCESS: &str = "KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": []}";
const HELLO: &str = "format: konductor/1\nname: hello\nversion: 0.1.0\nintent:\n  outcome: Say hello\nstages:\n  - name: write\n    agent: k-developer\n  - name: review\n    agent: k-quality-assurance\n";

fn one_at_a_time() -> std::sync::MutexGuard<'static, ()> {
    static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());
    SERIAL.lock().unwrap_or_else(|p| p.into_inner())
}

/// The entry of a test: the same checks in the same order as `flow run`, on the fake harness. The trust record is the
/// real file store under a scratch home. A project with no tool configuration needs trust only for its workflow.
/// What a live run does: a session of `write` that waits for the gate (if there is one), and a session of every other
/// stage that sleeps in its own process group.
#[derive(Clone)]
struct Live {
    gate: Option<Arc<Mutex<mpsc::Receiver<()>>>>,
}

struct LiveHarness {
    gate: Option<Arc<Mutex<mpsc::Receiver<()>>>>,
    launcher: SystemLauncher,
    cwd: String,
}

impl Harness for LiveHarness {
    fn run_session(&mut self, session: &Session) -> SessionOutcome {
        self.run_session_recorded(session, &mut |_| Ok(()))
    }

    fn run_session_recorded(
        &mut self,
        session: &Session,
        started: &mut dyn FnMut(&ProcessGroup) -> Result<(), String>,
    ) -> SessionOutcome {
        if let (Some(gate), "write") = (&self.gate, session.stage) {
            let _ = gate.lock().unwrap().recv();
            return SessionOutcome {
                end: SessionEnd::Exited(0),
                final_message: SUCCESS.to_string(),
            };
        }
        let args = vec!["-c".to_string(), "exec sleep 60".to_string()];
        let launched = self.launcher.launch(
            &Launch {
                program: "/bin/sh",
                args: &args,
                cwd: &self.cwd,
                time_limit_ms: 120_000,
                keep_output_bytes: 1024,
                keep_head_bytes: 0,
            },
            started,
        );
        let end = match launched.end {
            LaunchEnd::Exited(code) => SessionEnd::Exited(code),
            LaunchEnd::TimedOut => SessionEnd::TimedOut,
            LaunchEnd::NotStarted(_) => SessionEnd::NotStarted,
            LaunchEnd::Interrupted => SessionEnd::Interrupted,
        };
        SessionOutcome {
            end,
            final_message: launched.output,
        }
    }
}

struct TestEntry {
    project: PathBuf,
    home: PathBuf,
    /// A named pipe that the first stage waits on, so a test can hold a run open. `None` runs at once.
    hold: Option<PathBuf>,
    /// Runs real sessions (a `sleep` in its own process group) instead of the fake harness.
    live: Option<Live>,
    harness_missing: AtomicBool,
}

impl TestEntry {
    fn repo_key(&self) -> String {
        fs::canonicalize(&self.project)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string()
    }
}

impl RunEntry for TestEntry {
    fn start(&self, request: &StartRequest) -> Result<StartedRun, StartRefusal> {
        let hash = request.checked.trust_inputs.hash(&[]);
        let record = FileTrustStore::new(Some(&self.home)).recorded(&self.repo_key(), request.name);
        if !matches!(decide(&hash, record.as_deref(), None), Verdict::Trusted) {
            return Err(StartRefusal::TrustRequired);
        }
        match FileRunLock::peek(&self.project).map_err(|error| StartRefusal::Storage(error.0))? {
            Peek::Held(record) => {
                return Err(StartRefusal::AlreadyRunning(record.map(|r| r.run_id)))
            }
            Peek::Free => {}
        }
        if self.harness_missing.load(Ordering::SeqCst) {
            return Err(StartRefusal::HarnessUnavailable {
                error: "claude is not installed.".to_string(),
                fix: "Install claude and sign in, then try again.".to_string(),
            });
        }
        let workflow = request.checked.workflow.clone().unwrap();
        let prepared = prepare(workflow, Some(request.goal), &BTreeMap::new()).unwrap();
        let mut store =
            FileRunStore::open(&self.project).map_err(|error| StartRefusal::Storage(error.0))?;
        let mut lock = FileRunLock::new(&self.project);
        let mut launcher = SystemLauncher::new();
        let started = start(
            &prepared,
            "fake",
            current_owner(),
            &mut store,
            &mut lock,
            &SystemClock,
            &mut launcher,
        )
        .map_err(|e| match e {
            workflow_core::runner::StartError::AlreadyRunning(r) => {
                StartRefusal::AlreadyRunning(Some(r.run_id))
            }
            workflow_core::runner::StartError::UnreadableLock => StartRefusal::AlreadyRunning(None),
            workflow_core::runner::StartError::Port(error) => StartRefusal::Storage(error.0),
        })?;
        let run_id = started.run.run_id.clone();
        let hold = self.hold.clone();
        let live = self.live.clone();
        let cwd = self.project.to_string_lossy().into_owned();
        let handle = std::thread::spawn(move || {
            let mut script = Script::default();
            for (n, stage) in ["write", "review"].iter().enumerate() {
                script.stages.insert(
                    stage.to_string(),
                    Entry {
                        reply: SUCCESS.to_string(),
                        exit_status: 0,
                        duration_ms: 0,
                        wait_for: if n == 0 { hold.clone() } else { None },
                    },
                );
            }
            let clock = Rc::new(SimulatedClock::default());
            let mut harness: Box<dyn Harness> = match live {
                Some(live) => Box::new(LiveHarness {
                    gate: live.gate,
                    launcher: SystemLauncher::new(),
                    cwd,
                }),
                None => Box::new(FakeHarness::new(script, Rc::clone(&clock))),
            };
            let mut run = started.run;
            let _ = execute(
                &mut run,
                &prepared,
                &mut *harness,
                &*clock,
                &mut store,
                &mut |_| {},
            );
            lock.release();
        });
        Ok(StartedRun { run_id, handle })
    }
}

struct Fixture {
    project: TempDir,
    home: TempDir,
    _page: TempDir,
    entry: Arc<TestEntry>,
    server: Option<CanvasServer>,
    port: u16,
    token: Option<String>,
}

fn fixture(hold: Option<PathBuf>) -> Fixture {
    fixture_with(hold, None)
}

fn fixture_with(hold: Option<PathBuf>, live: Option<Live>) -> Fixture {
    let project = TempDir::new("canvas-project");
    let home = TempDir::new("canvas-home");
    let page = TempDir::new("canvas-page");
    project.write(".konductor/workflows/hello.yml", HELLO.as_bytes());
    page.write(
        "index.html",
        b"<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; base-uri 'none'; form-action 'none'\">",
    );
    page.write("assets/app.js", b"console.log(1)");
    fs::write(page.path().join("../canvas-outside.txt"), "outside").unwrap();
    let entry = Arc::new(TestEntry {
        project: project.path().to_path_buf(),
        home: home.path().to_path_buf(),
        hold,
        live,
        harness_missing: AtomicBool::new(false),
    });
    let server = CanvasServer::start(CanvasConfig {
        root: "hello".to_string(),
        source: FileSource::under(project.path()),
        scope: Scope::Project,
        project_root: project.path().to_path_buf(),
        harness: "fake".to_string(),
        konductor_version: "1.2.3-test".to_string(),
        page_dir: page.path().to_path_buf(),
        launch_code: CODE.to_string(),
        entry: entry.clone(),
        clock: Arc::new(SystemClock),
    })
    .expect("the server starts");
    let port = server.port();
    Fixture {
        project,
        home,
        _page: page,
        entry,
        server: Some(server),
        port,
        token: None,
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(server) = self.server.take() {
            server.stop(Duration::from_secs(5));
        }
    }
}

struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    fn json(&self) -> Json {
        json::parse(&self.body).unwrap_or_else(|_| panic!("not JSON: {}", self.body))
    }

    fn code(&self) -> String {
        self.json()
            .get("code")
            .and_then(Json::as_str)
            .unwrap_or("")
            .to_string()
    }
}

/// Sends raw bytes and reads the answer to the end.
fn raw(port: u16, request: &[u8]) -> Reply {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let _ = stream.write_all(request);
    let mut bytes = Vec::new();
    let _ = stream.read_to_end(&mut bytes);
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|l| l.split(' ').nth(1))
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let headers = lines
        .filter_map(|l| l.split_once(": "))
        .map(|(n, v)| (n.to_string(), v.to_string()))
        .collect();
    Reply {
        status,
        headers,
        body: body.to_string(),
    }
}

/// A well-formed call: own Host and Origin, a JSON type and the token. `edit` may change a default header.
fn call_with(
    f: &Fixture,
    method: &str,
    path: &str,
    body: Option<&str>,
    edit: &dyn Fn(&str, String) -> Option<String>,
) -> Reply {
    let mut head = format!("{method} {path} HTTP/1.1\r\n");
    let mut add = |name: &str, value: String| {
        if let Some(value) = edit(name, value) {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
    };
    add("Host", format!("127.0.0.1:{}", f.port));
    if method != "GET" {
        add("Origin", format!("http://127.0.0.1:{}", f.port));
        add("Content-Type", "application/json".to_string());
    }
    if let Some(token) = &f.token {
        add("Authorization", format!("Bearer {token}"));
    }
    let body = body.unwrap_or("");
    if method != "GET" {
        add("Content-Length", body.len().to_string());
    }
    head.push_str("\r\n");
    head.push_str(body);
    raw(f.port, head.as_bytes())
}

fn call(f: &Fixture, method: &str, path: &str, body: Option<&str>) -> Reply {
    call_with(f, method, path, body, &|_, v| Some(v))
}

fn signed_in() -> Fixture {
    signed_in_with(None)
}

fn signed_in_with(hold: Option<PathBuf>) -> Fixture {
    let mut f = fixture(hold);
    let reply = call(
        &f,
        "POST",
        "/api/session",
        Some(&format!("{{\"code\":\"{CODE}\"}}")),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    f.token = reply
        .json()
        .get("token")
        .and_then(Json::as_str)
        .map(str::to_string);
    f
}

fn hash_of(f: &Fixture) -> String {
    let reply = call(f, "GET", "/api/workflow", None);
    reply
        .json()
        .get("hash")
        .and_then(Json::as_str)
        .unwrap()
        .to_string()
}

fn save_body(text: &str, base: Option<&str>) -> String {
    let mut body = Json::object();
    body.insert("text", Json::str(text));
    body.insert("base_hash", base.map_or(Json::Null, Json::str));
    body.compact()
}

fn run_body() -> &'static str {
    "{\"params\":{\"goal\":\"Say hello\"}}"
}

/// Records trust for the current bytes of `hello.yml`, as `flow trust` would.
fn trust(f: &Fixture) {
    let source = FileSource::under(f.project.path());
    let text = fs::read_to_string(f.project.path().join(".konductor/workflows/hello.yml")).unwrap();
    let checked = workflow_core::check_text("hello", &text, &source);
    let hash = checked.trust_inputs.hash(&[]);
    FileTrustStore::new(Some(f.home.path()))
        .record(&f.entry.repo_key(), "hello", &hash)
        .unwrap();
}

fn wait_for_status(f: &Fixture, run_id: &str, want: &str) -> Json {
    let until = Instant::now() + Duration::from_secs(20);
    loop {
        let reply = call(f, "GET", &format!("/api/runs/{run_id}"), None);
        let run = reply.json().get("run").cloned().unwrap();
        if run.get("status").and_then(Json::as_str) == Some(want) {
            return run;
        }
        assert!(
            Instant::now() < until,
            "run never became {want}: {}",
            reply.body
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// A process that holds the workspace lock, as a run of another `konductor` would.
struct OtherOwner(Child);

impl OtherOwner {
    fn start(project: &Path, run_id: &str) -> OtherOwner {
        let mut store = FileRunStore::open(project).unwrap();
        let _ = &mut store;
        let lock = FileRunLock::new(project);
        let record = LockRecord {
            owner: Owner {
                pid: 1,
                started: "2026-01-01T00:00:00Z".to_string(),
            },
            run_id: run_id.to_string(),
        };
        fs::write(lock.path(), record.to_text()).unwrap();
        // One process holds the lock: the shell opens the file, takes the lock on it and becomes `sleep`.
        let child = Command::new("sh")
            .arg("-c")
            .arg("exec 9<>\"$0\"; flock --exclusive 9 && exec sleep 60")
            .arg(lock.path())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("flock is installed");
        // Wait until the child holds it.
        let until = Instant::now() + Duration::from_secs(10);
        while FileRunLock::peek(project).unwrap() == Peek::Free {
            assert!(Instant::now() < until, "the child never took the lock");
            std::thread::sleep(Duration::from_millis(10));
        }
        OtherOwner(child)
    }
}

impl Drop for OtherOwner {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The page

#[test]
fn the_page_carries_a_policy_header_with_frame_ancestors() {
    let _serial = one_at_a_time();
    let f = fixture(None);
    let reply = call(&f, "GET", "/", None);
    assert_eq!(reply.status, 200);
    let policy = reply
        .header("content-security-policy")
        .expect("a CSP header");
    assert!(policy.contains("frame-ancestors 'none'"), "{policy}");
    assert!(policy.contains("default-src 'self'"), "{policy}");
    assert_eq!(reply.header("x-konductor-api"), Some("1"));
    assert_eq!(reply.header("cache-control"), Some("no-store"));
    assert!(reply.header("set-cookie").is_none());
    assert!(reply.header("access-control-allow-origin").is_none());
}

#[test]
fn the_page_serves_its_files_and_nothing_outside_its_folder() {
    let _serial = one_at_a_time();
    let f = fixture(None);
    assert_eq!(call(&f, "GET", "/assets/app.js", None).status, 200);
    for path in [
        "/../canvas-outside.txt",
        "/%2e%2e/canvas-outside.txt",
        "/assets/../../canvas-outside.txt",
        "/assets/missing.js",
    ] {
        assert_eq!(call(&f, "GET", path, None).status, 404, "{path}");
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Guards, in the order of the contract

#[test]
fn a_wrong_host_gets_forbidden_host_before_anything_else() {
    let _serial = one_at_a_time();
    let f = signed_in();
    for host in [
        "evil.example",
        "127.0.0.1",
        "127.0.0.1.evil.example:80",
        "localhost:1",
    ] {
        let reply = call_with(&f, "GET", "/api/workflow", None, &|n, v| {
            if n == "Host" {
                Some(host.to_string())
            } else {
                Some(v)
            }
        });
        assert_eq!(
            (reply.status, reply.code().as_str()),
            (403, "forbidden_host"),
            "{host}"
        );
        // The answer holds nothing about the workflow.
        assert!(!reply.body.contains("hello"));
    }
    // Host comes before the path and the method.
    let reply = call_with(&f, "DELETE", "/nowhere", None, &|n, v| {
        if n == "Host" {
            Some("evil".into())
        } else {
            Some(v)
        }
    });
    assert_eq!(reply.code(), "forbidden_host");
    // A request with no Host at all.
    let reply = raw(f.port, b"GET /api/workflow HTTP/1.1\r\n\r\n");
    assert_eq!(reply.code(), "forbidden_host");
}

#[test]
fn the_checks_run_in_the_order_the_contract_gives() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let no_token = |n: &str, v: String| if n == "Authorization" { None } else { Some(v) };
    // Path before method, method before origin.
    assert_eq!(call(&f, "GET", "/api/nothing", None).code(), "not_found");
    let reply = call(&f, "DELETE", "/api/workflow", None);
    assert_eq!(
        (reply.status, reply.code().as_str()),
        (405, "method_not_allowed")
    );
    assert_eq!(reply.header("allow"), Some("GET, PUT"));
    assert_eq!(
        call(&f, "PUT", "/api/run", None).header("allow"),
        Some("POST")
    );
    let foreign = |n: &str, v: String| match n {
        "Origin" => Some("http://evil.example".to_string()),
        "Authorization" => None,
        _ => Some(v),
    };
    // Origin before the token.
    assert_eq!(
        call_with(&f, "PUT", "/api/workflow", Some("{}"), &foreign).code(),
        "forbidden_origin"
    );
    assert_eq!(
        call_with(&f, "GET", "/api/workflow", None, &no_token).code(),
        "unauthorized"
    );
    // Token before content type, content type before size, size before shape.
    let bad_type = |n: &str, v: String| match n {
        "Content-Type" => Some("text/plain".to_string()),
        "Authorization" => None,
        _ => Some(v),
    };
    assert_eq!(
        call_with(&f, "POST", "/api/validate", Some("{}"), &bad_type).code(),
        "unauthorized"
    );
    let bad_type = |n: &str, v: String| {
        if n == "Content-Type" {
            Some("text/plain".to_string())
        } else {
            Some(v)
        }
    };
    assert_eq!(
        call_with(
            &f,
            "POST",
            "/api/validate",
            Some("x".repeat(2 << 20).as_str()),
            &bad_type
        )
        .code(),
        "bad_request"
    );
    assert_eq!(
        call(&f, "POST", "/api/validate", Some(&"x".repeat(2 << 20))).code(),
        "too_large"
    );
    assert_eq!(
        call(&f, "POST", "/api/validate", Some("not json")).code(),
        "bad_request"
    );
    // Shape before name, name before the root, the root before base_hash, base_hash before the text.
    assert_eq!(
        call(
            &f,
            "PUT",
            "/api/workflow",
            Some("{\"text\":1,\"base_hash\":null}")
        )
        .code(),
        "bad_request"
    );
    assert_eq!(
        call(
            &f,
            "PUT",
            "/api/workflow",
            Some("{\"name\":\"Bad_Name\",\"text\":\"x\",\"base_hash\":\"zz\"}")
        )
        .code(),
        "bad_name"
    );
    assert_eq!(
        call(
            &f,
            "PUT",
            "/api/workflow",
            Some("{\"name\":\"other\",\"text\":\"x\",\"base_hash\":\"zz\"}")
        )
        .code(),
        "read_only_workflow"
    );
    assert_eq!(
        call(
            &f,
            "PUT",
            "/api/workflow",
            Some("{\"text\":\"x\",\"base_hash\":\"zz\"}")
        )
        .code(),
        "bad_hash"
    );
    let big = "a".repeat(262_145);
    assert_eq!(
        call(&f, "PUT", "/api/workflow", Some(&save_body(&big, None))).code(),
        "too_large"
    );
    assert_eq!(
        call(
            &f,
            "PUT",
            "/api/workflow",
            Some(&save_body("not: [valid", None))
        )
        .code(),
        "invalid_workflow"
    );
}

#[test]
fn a_body_over_one_mebibyte_is_refused_with_too_large() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let body = format!("{{\"text\":\"{}\"}}", "a".repeat(1_048_576));
    let reply = call(&f, "POST", "/api/validate", Some(&body));
    assert_eq!((reply.status, reply.code().as_str()), (413, "too_large"));
    // The limit is on the body: 1 MiB exactly still reaches the check of the text, which is smaller.
    assert_eq!(
        call(
            &f,
            "POST",
            "/api/validate",
            Some(&format!("{{\"text\":\"{}\"}}", "a".repeat(262_145)))
        )
        .code(),
        "too_large"
    );
}

#[test]
fn a_request_line_or_headers_over_their_caps_are_refused() {
    let _serial = one_at_a_time();
    let f = fixture(None);
    let long = format!(
        "GET /{} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n",
        "a".repeat(9000),
        f.port
    );
    assert_eq!(raw(f.port, long.as_bytes()).code(), "bad_request");
    let many: String = (0..70).map(|i| format!("X-H{i}: v\r\n")).collect();
    let req = format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n{many}\r\n", f.port);
    assert_eq!(raw(f.port, req.as_bytes()).code(), "bad_request");
    let wide = format!(
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nX-Big: {}\r\n\r\n",
        f.port,
        "a".repeat(40_000)
    );
    assert_eq!(raw(f.port, wide.as_bytes()).code(), "bad_request");
    let chunked = format!("POST /api/session HTTP/1.1\r\nHost: 127.0.0.1:{0}\r\nOrigin: http://127.0.0.1:{0}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n", f.port);
    assert_eq!(raw(f.port, chunked.as_bytes()).code(), "bad_request");
    assert_eq!(raw(f.port, b"nonsense\r\n\r\n").code(), "bad_request");
}

#[test]
fn the_server_listens_on_the_loopback_address_only() {
    let _serial = one_at_a_time();
    let f = fixture(None);
    let listing = Command::new("ss").args(["-ltnH"]).output();
    if let Ok(out) = listing {
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        let mine: Vec<&str> = text
            .lines()
            .filter(|l| l.contains(&format!(":{}", f.port)))
            .collect();
        assert!(!mine.is_empty(), "{text}");
        assert!(
            mine.iter()
                .all(|l| l.contains(&format!("127.0.0.1:{}", f.port))),
            "{mine:?}"
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Session

/// The session reply has the fields of the contract's `SessionResponse` and no other. A field that a later contract
/// adds is added here with the code that fills it.
#[test]
fn the_session_reply_holds_only_the_fields_the_contract_names() {
    let _serial = one_at_a_time();
    let f = fixture(None);
    let body = format!("{{\"code\":\"{CODE}\"}}");
    let reply = call(&f, "POST", "/api/session", Some(&body)).json();
    let Json::Object(fields) = reply else {
        panic!("the session reply is not an object");
    };
    let names: Vec<&str> = fields.keys().map(String::as_str).collect();
    assert_eq!(
        names,
        [
            "api_version",
            "capabilities",
            "harness",
            "konductor_version",
            "limits",
            "root",
            "token"
        ]
    );
}

#[test]
fn the_launch_code_works_once_and_a_wrong_one_does_not() {
    let _serial = one_at_a_time();
    let f = fixture(None);
    let body = |code: &str| format!("{{\"code\":\"{code}\"}}");
    assert_eq!(
        call(&f, "POST", "/api/session", Some(&body("wrong"))).code(),
        "invalid_code"
    );
    let first = call(&f, "POST", "/api/session", Some(&body(CODE)));
    assert_eq!(first.status, 200);
    let json = first.json();
    assert_eq!(json.get("root").and_then(Json::as_str), Some("hello"));
    assert_eq!(json.get("harness").and_then(Json::as_str), Some("fake"));
    assert_eq!(json.get("api_version").and_then(Json::as_u64), Some(1));
    assert_eq!(json.get("token").and_then(Json::as_str).unwrap().len(), 64);
    assert_eq!(
        call(&f, "POST", "/api/session", Some(&body(CODE))).code(),
        "invalid_code"
    );
    assert_eq!(
        call(
            &f,
            "POST",
            "/api/session",
            Some("{\"code\":\"x\",\"extra\":1}")
        )
        .code(),
        "bad_request"
    );
}

/// The session of a fresh server, and a fixture that holds its token.
fn session_of(f: &mut Fixture) -> Json {
    let session = call(
        f,
        "POST",
        "/api/session",
        Some(&format!("{{\"code\":\"{CODE}\"}}")),
    );
    assert_eq!(session.status, 200, "{}", session.body);
    let json = session.json();
    f.token = json.get("token").and_then(Json::as_str).map(str::to_string);
    json
}

#[test]
fn the_session_says_which_server_it_is_what_it_serves_and_its_limits() {
    let _serial = one_at_a_time();
    let mut f = fixture(None);
    let json = session_of(&mut f);
    assert_eq!(
        json.get("konductor_version").and_then(Json::as_str),
        Some("1.2.3-test")
    );
    let limits = json.get("limits").expect("limits");
    let limit = |key: &str| limits.get(key).and_then(Json::as_u64);
    assert_eq!(limit("text_bytes"), Some(262_144));
    assert_eq!(limit("stages"), Some(40));
    assert_eq!(limit("outcome_chars"), Some(300));
    assert_eq!(limit("prompt_chars"), Some(32_768));
    assert_eq!(limit("goal_chars"), Some(2048));
}

/// What the server answers on each operation of the contract that it serves, with the method and path.
const SERVED: [(&str, &str, &str); 6] = [
    ("createSession", "POST", "/api/session"),
    ("getWorkflow", "GET", "/api/workflow"),
    ("saveWorkflow", "PUT", "/api/workflow"),
    ("checkWorkflow", "POST", "/api/validate"),
    ("startRun", "POST", "/api/run"),
    ("getRun", "GET", "/api/runs/20261024-0412-a7b3c"),
];

#[test]
fn the_capabilities_are_the_operations_that_the_server_answers_and_no_others() {
    let _serial = one_at_a_time();
    let mut f = fixture(None);
    let json = session_of(&mut f);
    let mut listed: Vec<&str> = json
        .get("capabilities")
        .and_then(Json::as_array)
        .expect("capabilities")
        .iter()
        .map(|id| id.as_str().expect("an operationId"))
        .collect();
    listed.sort_unstable();
    let mut served: Vec<&str> = SERVED.iter().map(|(id, _, _)| *id).collect();
    served.sort_unstable();
    assert_eq!(listed, served);
    for (id, method, path) in SERVED {
        let answer = call(&f, method, path, Some("{}"));
        // A run id that no run has is a 404 `not_found` of the operation itself, as is the reply to no body.
        assert_ne!(answer.status, 405, "{id} takes {method}");
        assert_ne!(answer.status, 401, "{id} is behind the token it was given");
    }
    // An operation that is not listed is not answered.
    assert_eq!(
        call(&f, "GET", "/api/runs/20261024-0412-a7b3c/events", None).code(),
        "not_found"
    );
}

#[test]
fn a_call_with_a_wrong_or_missing_token_is_unauthorized_and_the_answer_holds_no_secret() {
    let _serial = one_at_a_time();
    let mut f = signed_in();
    let token = f.token.clone().unwrap();
    f.token = Some("0".repeat(64));
    let reply = call(&f, "GET", "/api/workflow", None);
    assert_eq!((reply.status, reply.code().as_str()), (401, "unauthorized"));
    assert!(!reply.body.contains(&token) && !reply.body.contains(CODE));
    f.token = None;
    assert_eq!(
        call(&f, "GET", "/api/workflow", None).code(),
        "unauthorized"
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Workflow

#[test]
fn getworkflow_returns_the_text_the_hash_and_the_view() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let reply = call(&f, "GET", "/api/workflow", None);
    assert_eq!(reply.status, 200);
    let json = reply.json();
    assert_eq!(json.get("text").and_then(Json::as_str), Some(HELLO));
    assert_eq!(
        json.get("hash").and_then(Json::as_str),
        Some(sha256_hex(HELLO.as_bytes()).as_str())
    );
    assert_eq!(json.get("read_only"), Some(&Json::Bool(false)));
    let view = json.get("view").unwrap();
    assert_eq!(view.get("name").and_then(Json::as_str), Some("hello"));
    assert!(
        view.get("params").is_none(),
        "a key the file leaves out is left out"
    );
    assert_eq!(
        view.get("stages")
            .and_then(Json::as_array)
            .map(<[Json]>::len),
        Some(2)
    );
    assert_eq!(
        call(&f, "GET", "/api/workflow?name=hello", None).status,
        200
    );
    assert_eq!(
        call(&f, "GET", "/api/workflow?name=other", None).code(),
        "not_found"
    );
    assert_eq!(
        call(&f, "GET", "/api/workflow?name=Bad_Name", None).code(),
        "bad_name"
    );
    assert_eq!(
        call(&f, "GET", "/api/workflow?name=hello&name=hello", None).code(),
        "bad_name"
    );
}

/// The keys of the `agent` kind in the answer, as `(key, type, required)`.
fn agent_fields(json: &Json) -> Vec<(String, String, bool)> {
    json.get("stage_fields")
        .and_then(|fields| fields.get("agent"))
        .and_then(Json::as_array)
        .expect("stage_fields has the agent kind")
        .iter()
        .map(|field| {
            (
                field.get("key").and_then(Json::as_str).unwrap().to_string(),
                field
                    .get("type")
                    .and_then(Json::as_str)
                    .unwrap()
                    .to_string(),
                field.get("required") == Some(&Json::Bool(true)),
            )
        })
        .collect()
}

#[test]
fn getworkflow_says_which_keys_of_a_stage_a_client_may_edit_and_what_each_takes() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let json = call(&f, "GET", "/api/workflow", None).json();
    let want = [
        ("name", "name", true),
        ("agent", "name", true),
        ("prompt", "text", false),
        ("prompt_file", "path", false),
    ]
    .map(|(key, kind, required)| (key.to_string(), kind.to_string(), required));
    assert_eq!(agent_fields(&json), want);
    let fields = json
        .get("stage_fields")
        .and_then(|f| f.get("agent"))
        .and_then(Json::as_array)
        .unwrap();
    let by_key = |key: &str| {
        fields
            .iter()
            .find(|f| f.get("key").and_then(Json::as_str) == Some(key))
            .unwrap()
    };
    // The limits are the ones the checker enforces.
    let prompt = by_key("prompt");
    assert_eq!(prompt.get("min_length").and_then(Json::as_u64), Some(1));
    assert_eq!(
        prompt.get("max_length").and_then(Json::as_u64),
        Some(32_768)
    );
    assert_eq!(
        prompt.get("excludes"),
        Some(&Json::Array(vec![Json::str("prompt_file")]))
    );
    assert_eq!(
        by_key("prompt_file").get("excludes"),
        Some(&Json::Array(vec![Json::str("prompt")]))
    );
    let name = by_key("name");
    assert_eq!(name.get("max_length").and_then(Json::as_u64), Some(64));
    assert_eq!(
        name.get("reserved"),
        Some(&Json::Array(
            ["start", "end", "run", "halt"].map(Json::str).to_vec()
        ))
    );
    assert_eq!(
        name.get("pattern").and_then(Json::as_str),
        Some("^[a-z0-9][a-z0-9-]{0,63}$")
    );
}

#[test]
fn getworkflow_has_the_stage_fields_when_the_view_is_null() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let broken = HELLO.replace("version: 0.1.0", "version: '1.1'");
    fs::write(
        f.project.path().join(".konductor/workflows/hello.yml"),
        broken,
    )
    .unwrap();
    let json = call(&f, "GET", "/api/workflow", None).json();
    assert_eq!(json.get("view"), Some(&Json::Null));
    assert_eq!(agent_fields(&json).len(), 4);
}

#[test]
fn each_stage_of_a_view_has_its_kind_and_its_lines_in_every_answer_that_carries_a_view() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let stages_of = |json: &Json| -> Vec<(String, u64, u64)> {
        json.get("view")
            .and_then(|v| v.get("stages"))
            .and_then(Json::as_array)
            .expect("stages")
            .iter()
            .map(|stage| {
                let range = stage.get("range").expect("range");
                (
                    stage
                        .get("kind")
                        .and_then(Json::as_str)
                        .unwrap()
                        .to_string(),
                    range.get("line").and_then(Json::as_u64).unwrap(),
                    range.get("end_line").and_then(Json::as_u64).unwrap(),
                )
            })
            .collect()
    };
    // HELLO has two stages of two lines each, from line 7.
    let want = vec![("agent".to_string(), 7, 8), ("agent".to_string(), 9, 10)];
    let mut check_body = Json::object();
    check_body.insert("text", Json::str(HELLO));
    let check_body = check_body.compact();
    assert_eq!(
        stages_of(&call(&f, "GET", "/api/workflow", None).json()),
        want
    );
    assert_eq!(
        stages_of(&call(&f, "POST", "/api/validate", Some(&check_body)).json()),
        want
    );
    let hash = hash_of(&f);
    let saved = call(
        &f,
        "PUT",
        "/api/workflow",
        Some(&save_body(HELLO, Some(&hash))),
    );
    assert_eq!(saved.status, 200, "{}", saved.body);
    assert_eq!(stages_of(&saved.json()), want);
}

#[test]
fn getworkflow_gives_the_same_diagnostics_as_the_checker() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let broken = HELLO.replace("version: 0.1.0", "version: '1.1'");
    fs::write(
        f.project.path().join(".konductor/workflows/hello.yml"),
        &broken,
    )
    .unwrap();
    let json = call(&f, "GET", "/api/workflow", None).json();
    assert_eq!(json.get("view"), Some(&Json::Null));
    let found = json.get("diagnostics").and_then(Json::as_array).unwrap();
    let checked = workflow_core::check_text("hello", &broken, &FileSource::under(f.project.path()));
    assert_eq!(found.len(), checked.diagnostics.len());
    assert_eq!(found[0], checked.diagnostics[0].to_json());
}

#[test]
fn a_file_that_is_a_link_a_directory_or_too_large_is_not_found_and_nothing_is_written() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let path = f.project.path().join(".konductor/workflows/hello.yml");
    fs::remove_file(&path).unwrap();
    fs::write(f.project.path().join("elsewhere.yml"), HELLO).unwrap();
    std::os::unix::fs::symlink(f.project.path().join("elsewhere.yml"), &path).unwrap();
    assert_eq!(call(&f, "GET", "/api/workflow", None).code(), "not_found");
    assert_eq!(
        call(&f, "PUT", "/api/workflow", Some(&save_body(HELLO, None))).code(),
        "not_found"
    );
    assert_eq!(
        call(&f, "POST", "/api/run", Some(run_body())).code(),
        "not_found"
    );
    assert_eq!(
        fs::read_to_string(f.project.path().join("elsewhere.yml")).unwrap(),
        HELLO
    );
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert_eq!(call(&f, "GET", "/api/workflow", None).code(), "not_found");
    fs::remove_dir(&path).unwrap();
    fs::write(&path, "a".repeat(262_145)).unwrap();
    assert_eq!(call(&f, "GET", "/api/workflow", None).code(), "not_found");
    fs::write(&path, [0xff, 0xfe]).unwrap();
    assert_eq!(call(&f, "GET", "/api/workflow", None).code(), "not_found");
}

#[test]
fn savework_writes_the_bytes_exactly_as_sent() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let path = f.project.path().join(".konductor/workflows/hello.yml");
    // A byte order mark, CRLF line ends and no final newline: none of them is changed.
    let text = format!(
        "\u{feff}{}",
        HELLO.replace('\n', "\r\n").trim_end_matches("\r\n")
    );
    let reply = call(
        &f,
        "PUT",
        "/api/workflow",
        Some(&save_body(&text, Some(&hash_of(&f)))),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(fs::read(&path).unwrap(), text.as_bytes());
    let json = reply.json();
    assert_eq!(
        json.get("hash").and_then(Json::as_str),
        Some(sha256_hex(text.as_bytes()).as_str())
    );
    // The same bytes with the current hash change nothing.
    let again = call(
        &f,
        "PUT",
        "/api/workflow",
        Some(&save_body(&text, Some(&sha256_hex(text.as_bytes())))),
    );
    assert_eq!(again.status, 200);
    let loaded = call(&f, "GET", "/api/workflow", None).json();
    assert_eq!(
        loaded.get("text").and_then(Json::as_str),
        Some(text.as_str())
    );
    // No temporary file is left behind.
    let names: Vec<String> = fs::read_dir(path.parent().unwrap())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, ["hello.yml"]);
}

#[test]
fn a_save_with_the_wrong_base_hash_is_a_conflict_and_changes_nothing() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let path = f.project.path().join(".konductor/workflows/hello.yml");
    let changed = HELLO.replace("Say hello", "Say goodbye");
    let reply = call(
        &f,
        "PUT",
        "/api/workflow",
        Some(&save_body(&changed, Some(&"0".repeat(64)))),
    );
    assert_eq!((reply.status, reply.code().as_str()), (409, "conflict"));
    assert_eq!(
        reply.json().get("current_hash").and_then(Json::as_str),
        Some(sha256_hex(HELLO.as_bytes()).as_str())
    );
    // A null base hash means the file must not exist yet.
    let reply = call(&f, "PUT", "/api/workflow", Some(&save_body(&changed, None)));
    assert_eq!(reply.code(), "conflict");
    assert!(reply.json().get("current_hash").is_some());
    assert_eq!(fs::read_to_string(&path).unwrap(), HELLO);
    // A hash for a file that is gone has no current hash.
    fs::remove_file(&path).unwrap();
    let reply = call(
        &f,
        "PUT",
        "/api/workflow",
        Some(&save_body(&changed, Some(&"0".repeat(64)))),
    );
    assert_eq!(reply.code(), "conflict");
    assert!(reply.json().get("current_hash").is_none());
    // And a null hash creates it.
    let created = call(&f, "PUT", "/api/workflow", Some(&save_body(&changed, None)));
    assert_eq!(created.status, 200);
    assert_eq!(fs::read_to_string(&path).unwrap(), changed);
}

#[test]
fn of_two_saves_with_one_base_hash_exactly_one_succeeds() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let base = hash_of(&f);
    let (a, b) = (
        HELLO.replace("Say hello", "A"),
        HELLO.replace("Say hello", "B"),
    );
    let first = call(
        &f,
        "PUT",
        "/api/workflow",
        Some(&save_body(&a, Some(&base))),
    );
    let second = call(
        &f,
        "PUT",
        "/api/workflow",
        Some(&save_body(&b, Some(&base))),
    );
    assert_eq!(
        (first.status, second.status, second.code().as_str()),
        (200, 409, "conflict")
    );
}

#[test]
fn checkworkflow_reports_every_problem_and_writes_nothing() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let text = HELLO.replace("version: 0.1.0", "version: 0.1.0\nowner: me");
    let mut body = Json::object();
    body.insert("text", Json::str(&text));
    let reply = call(&f, "POST", "/api/validate", Some(&body.compact()));
    assert_eq!(reply.status, 200);
    let json = reply.json();
    assert_eq!(json.get("errors").and_then(Json::as_u64), Some(1));
    assert_eq!(json.get("view"), Some(&Json::Null));
    let summary = json.get("summary").unwrap();
    assert_eq!(summary.get("valid"), Some(&Json::Bool(false)));
    assert_eq!(
        fs::read_to_string(f.project.path().join(".konductor/workflows/hello.yml")).unwrap(),
        HELLO
    );
    let mut other = Json::object();
    other.insert("name", Json::str("other"));
    other.insert("text", Json::str(HELLO));
    assert_eq!(
        call(&f, "POST", "/api/validate", Some(&other.compact())).code(),
        "read_only_workflow"
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Runs

/// The `name` of a run is optional and must be the root: after the body, a malformed one is `bad_name` and another one is
/// `read_only_workflow`, and both come before anything about the file or the trust is looked at.
#[test]
fn a_run_may_name_the_root_and_any_other_name_is_refused_before_anything_starts() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let with_name = |name: &str, params: &str| format!("{{\"name\":{name},\"params\":{params}}}");
    let goal = "{\"goal\":\"Say hello\"}";
    // The root passes the name check and meets the next one, the trust of the untrusted fixture.
    let root = call(&f, "POST", "/api/run", Some(&with_name("\"hello\"", goal)));
    assert_eq!(root.code(), "trust_required", "{}", root.body);
    let other = call(&f, "POST", "/api/run", Some(&with_name("\"other\"", goal)));
    assert_eq!(
        (other.status, other.code().as_str()),
        (403, "read_only_workflow")
    );
    assert!(other.body.contains("Reload the page"), "{}", other.body);
    let bad = call(
        &f,
        "POST",
        "/api/run",
        Some(&with_name("\"Not A Name\"", goal)),
    );
    assert_eq!((bad.status, bad.code().as_str()), (400, "bad_name"));
    // The body comes first: a missing goal is refused whatever the name is.
    let no_goal = call(&f, "POST", "/api/run", Some(&with_name("\"other\"", "{}")));
    assert_eq!(no_goal.code(), "bad_params");
    // A name that is not a string is a bad request.
    let number = call(&f, "POST", "/api/run", Some(&with_name("5", goal)));
    assert_eq!(number.code(), "bad_request");
}

#[test]
fn a_run_of_an_untrusted_workflow_is_refused_with_the_command_to_run() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let reply = call(&f, "POST", "/api/run", Some(run_body()));
    assert_eq!(
        (reply.status, reply.code().as_str()),
        (409, "trust_required")
    );
    let json = reply.json();
    let fix = json.get("fix").and_then(Json::as_str).unwrap();
    assert!(fix.contains("`konductor flow trust hello`"), "{fix}");
    assert_eq!(
        fix.matches('`').count(),
        2,
        "the command is the only text in backticks"
    );
    // Nothing was started: the runs folder was not even made.
    assert!(!f.project.path().join(".konductor/runs").exists());
}

#[test]
fn a_trusted_run_goes_through_the_fake_harness_and_passes() {
    let _serial = one_at_a_time();
    let f = signed_in();
    trust(&f);
    let reply = call(&f, "POST", "/api/run", Some(run_body()));
    assert_eq!(reply.status, 202, "{}", reply.body);
    let run_id = reply
        .json()
        .get("run_id")
        .and_then(Json::as_str)
        .unwrap()
        .to_string();
    let run = wait_for_status(&f, &run_id, "passed");
    assert_eq!(run.get("harness").and_then(Json::as_str), Some("fake"));
    assert_eq!(run.get("exit_code").and_then(Json::as_u64), Some(0));
    assert!(run.get("owner").is_none(), "the owner stays on disk");
    assert!(f.project.path().join(".konductor/.gitignore").exists());
    assert_eq!(
        call(&f, "GET", "/api/runs/20200101-0000-aaaaa", None).code(),
        "not_found"
    );
    assert_eq!(
        call(&f, "GET", "/api/runs/not-an-id", None).code(),
        "not_found"
    );
}

#[test]
fn a_save_that_changes_the_bytes_leaves_the_trust_record_and_the_next_run_needs_trust() {
    let _serial = one_at_a_time();
    let f = signed_in();
    trust(&f);
    let record = FileTrustStore::new(Some(f.home.path())).path().unwrap();
    let before = fs::read(&record).unwrap();
    let changed = HELLO.replace("Say hello", "Say goodbye");
    assert_eq!(
        call(
            &f,
            "PUT",
            "/api/workflow",
            Some(&save_body(&changed, Some(&hash_of(&f))))
        )
        .status,
        200
    );
    assert_eq!(
        fs::read(&record).unwrap(),
        before,
        "the server never writes the trust record"
    );
    assert_eq!(
        call(&f, "POST", "/api/run", Some(run_body())).code(),
        "trust_required"
    );
    // Saving the original bytes back matches the record again.
    assert_eq!(
        call(
            &f,
            "PUT",
            "/api/workflow",
            Some(&save_body(HELLO, Some(&hash_of(&f))))
        )
        .status,
        200
    );
    assert_eq!(call(&f, "POST", "/api/run", Some(run_body())).status, 202);
}

#[test]
fn a_run_body_is_checked_before_anything_about_the_run() {
    let _serial = one_at_a_time();
    let f = signed_in();
    for (body, code) in [
        ("{\"params\":{}}", "bad_params"),
        ("{\"params\":{\"goal\":\"\"}}", "bad_params"),
        (
            "{\"params\":{\"goal\":\"a\",\"other\":\"b\"}}",
            "bad_params",
        ),
        ("{}", "bad_request"),
        ("{\"params\":[]}", "bad_request"),
        ("{\"params\":{\"goal\":1}}", "bad_request"),
    ] {
        assert_eq!(
            call(&f, "POST", "/api/run", Some(body)).code(),
            code,
            "{body}"
        );
    }
    let long = format!("{{\"params\":{{\"goal\":\"{}\"}}}}", "é".repeat(2049));
    assert_eq!(
        call(&f, "POST", "/api/run", Some(&long)).code(),
        "bad_params"
    );
    let exact = format!("{{\"params\":{{\"goal\":\"{}\"}}}}", "é".repeat(2048));
    // 2048 characters are 4096 bytes, and the limit counts characters, so only trust stops this one.
    assert_eq!(
        call(&f, "POST", "/api/run", Some(&exact)).code(),
        "trust_required"
    );
}

#[test]
fn startrun_checks_the_file_the_workflow_trust_the_active_run_and_the_harness_in_that_order() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let path = f.project.path().join(".konductor/workflows/hello.yml");
    f.entry.harness_missing.store(true, Ordering::SeqCst);
    let _other = OtherOwner::start(f.project.path(), "20261024-0412-a7b3c");
    // The file, then the workflow.
    fs::remove_file(&path).unwrap();
    assert_eq!(
        call(&f, "POST", "/api/run", Some(run_body())).code(),
        "not_found"
    );
    fs::write(&path, "not: [valid").unwrap();
    assert_eq!(
        call(&f, "POST", "/api/run", Some(run_body())).code(),
        "invalid_workflow"
    );
    // Untrusted comes before the lock, which another process holds.
    fs::write(&path, HELLO).unwrap();
    let busy_untrusted = call(&f, "POST", "/api/run", Some(run_body()));
    assert_eq!(busy_untrusted.code(), "trust_required");
    assert!(
        !busy_untrusted.body.contains("20261024"),
        "a refused call does not reveal the run"
    );
    // Trusted: the active run comes before the harness.
    trust(&f);
    let busy = call(&f, "POST", "/api/run", Some(run_body()));
    assert_eq!(
        (busy.status, busy.code().as_str()),
        (409, "already_running")
    );
    assert_eq!(
        busy.json().get("run_id").and_then(Json::as_str),
        Some("20261024-0412-a7b3c")
    );
    drop(_other);
    let missing = call(&f, "POST", "/api/run", Some(run_body()));
    assert_eq!(
        (missing.status, missing.code().as_str()),
        (409, "harness_unavailable")
    );
    assert!(missing.json().get("fix").and_then(Json::as_str).is_some());
}

#[test]
fn a_second_run_is_refused_while_the_first_holds_the_lock() {
    let _serial = one_at_a_time();
    let dir = TempDir::new("canvas-hold");
    let fifo = dir.path().join("hold");
    assert!(Command::new("mkfifo")
        .arg(&fifo)
        .status()
        .unwrap()
        .success());
    let f = signed_in_with(Some(fifo.clone()));
    trust(&f);
    let first = call(&f, "POST", "/api/run", Some(run_body()));
    assert_eq!(first.status, 202);
    let run_id = first
        .json()
        .get("run_id")
        .and_then(Json::as_str)
        .unwrap()
        .to_string();
    let running = wait_for_status(&f, &run_id, "running");
    assert!(running.get("finished_at") == Some(&Json::Null));
    let second = call(&f, "POST", "/api/run", Some(run_body()));
    assert_eq!(
        (second.status, second.code().as_str()),
        (409, "already_running")
    );
    assert_eq!(
        second.json().get("run_id").and_then(Json::as_str),
        Some(run_id.as_str())
    );
    // Release the session, and the run ends.
    fs::write(&fifo, "go").unwrap();
    wait_for_status(&f, &run_id, "passed");
}

fn dead_run(project: &Path) -> String {
    let mut store = FileRunStore::open(project).unwrap();
    let run_id = store.reserve("20261024-0412").unwrap();
    let run = Run {
        run_id: run_id.clone(),
        workflow: "hello".to_string(),
        harness: "fake".to_string(),
        status: RunStatus::Running,
        started_at: 1_700_000_000_000,
        finished_at: None,
        exit_code: None,
        stages: ["write", "review"]
            .iter()
            .enumerate()
            .map(|(n, name)| StageState {
                name: name.to_string(),
                status: if n == 0 {
                    StageStatus::Running
                } else {
                    StageStatus::Pending
                },
                reported_outputs: Vec::new(),
            })
            .collect(),
        checks: BTreeMap::new(),
        owner: Owner {
            pid: 4_000_000,
            started: "2026-01-01T00:00:00Z".to_string(),
        },
        session_group: None,
    };
    store.write_state(&run_id, &run.to_text()).unwrap();
    run_id
}

#[test]
fn getrun_of_a_run_whose_owner_is_gone_reads_halted_and_the_state_is_written() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let run_id = dead_run(f.project.path());
    let reply = call(&f, "GET", &format!("/api/runs/{run_id}"), None);
    assert_eq!(reply.status, 200, "{}", reply.body);
    let run = reply.json().get("run").cloned().unwrap();
    assert_eq!(run.get("status").and_then(Json::as_str), Some("halted"));
    assert_eq!(run.get("exit_code").and_then(Json::as_u64), Some(1));
    let stages = run.get("stages").unwrap();
    assert_eq!(
        stages
            .get("write")
            .and_then(|s| s.get("status"))
            .and_then(Json::as_str),
        Some("blocked")
    );
    assert_eq!(
        stages
            .get("write")
            .and_then(|s| s.get("reason"))
            .and_then(Json::as_str),
        Some("SESSION_FAILED")
    );
    assert_eq!(
        stages
            .get("review")
            .and_then(|s| s.get("status"))
            .and_then(Json::as_str),
        Some("pending")
    );
    let on_disk = FileRunStore::open(f.project.path())
        .unwrap()
        .read_state(&run_id)
        .unwrap()
        .unwrap();
    assert_eq!(Run::from_text(&on_disk).unwrap().status, RunStatus::Halted);
}

/// There is no JSON schema validator in these tests, so this asserts the keys that the contract's `Run` requires and the
/// shape of `checks`: present, an object, and empty, because the engine refuses check keys until slice 3a.
#[test]
fn a_run_answer_has_every_key_the_contract_requires_and_an_empty_checks_map() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let run_id = dead_run(f.project.path());
    let reply = call(&f, "GET", &format!("/api/runs/{run_id}"), None);
    assert_eq!(reply.status, 200, "{}", reply.body);
    let run = reply.json().get("run").cloned().unwrap();
    let Json::Object(fields) = &run else {
        panic!("the run is not an object");
    };
    let keys: Vec<&str> = fields.keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        [
            "checks",
            "exit_code",
            "finished_at",
            "harness",
            "order",
            "run_id",
            "stages",
            "started_at",
            "status",
            "workflow",
        ]
    );
    assert_eq!(run.get("checks"), Some(&Json::object()));
}

#[test]
fn getrun_while_another_process_holds_the_lock_only_reads() {
    let _serial = one_at_a_time();
    let f = signed_in();
    let run_id = dead_run(f.project.path());
    let _owner = OtherOwner::start(f.project.path(), &run_id);
    let reply = call(&f, "GET", &format!("/api/runs/{run_id}"), None);
    let run = reply.json().get("run").cloned().unwrap();
    assert_eq!(run.get("status").and_then(Json::as_str), Some("running"));
    let on_disk = FileRunStore::open(f.project.path())
        .unwrap()
        .read_state(&run_id)
        .unwrap()
        .unwrap();
    assert_eq!(Run::from_text(&on_disk).unwrap().status, RunStatus::Running);
}

#[test]
fn getrun_in_a_project_that_never_ran_anything_makes_no_folder() {
    let _serial = one_at_a_time();
    let f = signed_in();
    assert_eq!(
        call(&f, "GET", "/api/runs/20261024-0412-a7b3c", None).code(),
        "not_found"
    );
    assert!(!f.project.path().join(".konductor/runs").exists());
}

// ---------------------------------------------------------------------------------------------------------------
// Stopping the server with a run that is live

/// The run state of `run_id`.
fn run_state(project: &Path, run_id: &str) -> Run {
    let store = FileRunStore::existing(project)
        .unwrap()
        .expect("a runs folder");
    Run::from_text(&store.read_state(run_id).unwrap().expect("a state")).expect("a run")
}

/// Waits until the run has recorded the process group of a session, and gives the group.
fn wait_for_group(project: &Path, run_id: &str) -> ProcessGroup {
    let until = Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(group) = run_state(project, run_id).session_group {
            return group;
        }
        assert!(Instant::now() < until, "no session group was recorded");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn stage_status(run: &Run, name: &str) -> StageStatus {
    run.stages.iter().find(|s| s.name == name).unwrap().status
}

#[test]
fn stopping_the_server_ends_the_live_session_and_the_run_reads_halted() {
    let _serial = one_at_a_time();
    let mut f = signed_in_with_live(Live { gate: None });
    trust(&f);
    let reply = call(&f, "POST", "/api/run", Some(run_body()));
    assert_eq!(reply.status, 202, "{}", reply.body);
    let run_id = reply
        .json()
        .get("run_id")
        .and_then(Json::as_str)
        .unwrap()
        .to_string();
    let group = wait_for_group(f.project.path(), &run_id);
    f.server.take().unwrap().stop(Duration::from_secs(30));
    let run = run_state(f.project.path(), &run_id);
    assert_eq!(run.status, RunStatus::Halted);
    assert_eq!(
        stage_status(&run, "write"),
        StageStatus::Blocked(workflow_core::Reason::SessionFailed)
    );
    assert_eq!(
        FileRunLock::peek(f.project.path()).unwrap(),
        Peek::Free,
        "the lock is given back"
    );
    assert_eq!(
        SystemLauncher::new().group_state(&group),
        GroupState::Gone,
        "no session is left"
    );
}

#[test]
fn a_session_that_starts_in_the_gap_between_two_stages_is_ended_too() {
    let _serial = one_at_a_time();
    let (release, gate) = mpsc::channel();
    let mut f = signed_in_with_live(Live {
        gate: Some(Arc::new(Mutex::new(gate))),
    });
    trust(&f);
    let reply = call(&f, "POST", "/api/run", Some(run_body()));
    let run_id = reply
        .json()
        .get("run_id")
        .and_then(Json::as_str)
        .unwrap()
        .to_string();
    // The first stage holds no session group, so a stop now finds nothing to end.
    let server = f.server.take().unwrap();
    let stopper = std::thread::spawn(move || server.stop(Duration::from_secs(30)));
    // Real time, because the stop loop runs on its own clock: it has to look and find nothing at least once.
    std::thread::sleep(Duration::from_millis(400));
    assert!(!stopper.is_finished());
    // The first stage ends, and the second one starts its session after the stop began.
    release.send(()).unwrap();
    stopper.join().unwrap();
    let run = run_state(f.project.path(), &run_id);
    assert_eq!(run.status, RunStatus::Halted);
    assert_eq!(stage_status(&run, "write"), StageStatus::Passed);
    assert_eq!(
        stage_status(&run, "review"),
        StageStatus::Blocked(workflow_core::Reason::SessionFailed)
    );
    assert_eq!(FileRunLock::peek(f.project.path()).unwrap(), Peek::Free);
}

fn signed_in_with_live(live: Live) -> Fixture {
    let mut f = fixture_with(None, Some(live));
    let reply = call(
        &f,
        "POST",
        "/api/session",
        Some(&format!("{{\"code\":\"{CODE}\"}}")),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    f.token = reply
        .json()
        .get("token")
        .and_then(Json::as_str)
        .map(str::to_string);
    f
}
