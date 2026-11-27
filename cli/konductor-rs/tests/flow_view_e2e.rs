// SPDX-License-Identifier: Apache-2.0
//
// flow_view_e2e.rs: drives the REAL compiled binary through `konductor flow view` on the `fake` harness.
//
// Isolation: every test uses a scratch project and a scratch `HOME`, a scratch page folder (`KONDUCTOR_CANVAS_DIR`),
// and no terminal. Telemetry, if a command reaches it, goes to a loopback sink. The server is stopped with a signal.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-flow-view-e2e-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn hello_plan() -> String {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../workflow-engine/examples/hello-plan.yml");
    std::fs::read_to_string(path).expect("read hello-plan.yml")
}

const SUCCESS: &str = r#"KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": [\"PLAN.md\"]}"#;

struct Project {
    root: PathBuf,
    home: PathBuf,
    page: PathBuf,
    script: PathBuf,
    /// A folder of stand-in programs that comes first on `PATH`.
    programs: PathBuf,
    sink: telemetry_test_sink::TelemetrySink,
}

impl Project {
    fn new(label: &str) -> Project {
        let root = scratch_dir(&format!("{label}-project"));
        let home = scratch_dir(&format!("{label}-home"));
        let page = scratch_dir(&format!("{label}-page"));
        std::fs::write(
            page.join("index.html"),
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'\">",
        )
        .unwrap();
        let script = root
            .join("..")
            .join(format!("script-{label}-{}.json", std::process::id()));
        std::fs::write(
            &script,
            format!(
                r#"{{"stages": {{"plan": {{"reply": "Wrote it.\n{SUCCESS}"}}, "implement": {{"reply": "{SUCCESS}"}}}}}}"#
            ),
        )
        .unwrap();
        std::fs::create_dir_all(root.join(".konductor/workflows")).unwrap();
        std::fs::write(
            root.join(".konductor/workflows/hello-plan.yml"),
            hello_plan(),
        )
        .unwrap();
        let programs = scratch_dir(&format!("{label}-programs"));
        let sink = telemetry_test_sink::TelemetrySink::start();
        Project {
            root,
            home,
            page,
            script,
            programs,
            sink,
        }
    }

    fn command<S: AsRef<std::ffi::OsStr>>(&self, args: &[S]) -> Command {
        let mut command = Command::new(bin());
        let path = std::env::var_os("PATH").unwrap_or_default();
        let mut dirs = vec![self.programs.clone()];
        dirs.extend(std::env::split_paths(&path));
        command
            .args(args)
            .current_dir(&self.root)
            .env("HOME", &self.home)
            .env("PATH", std::env::join_paths(dirs).unwrap())
            .env("KONDUCTOR_CANVAS_DIR", &self.page)
            .env("KONDUCTOR_FAKE_SCRIPT", &self.script)
            .env_remove("NO_COLOR")
            .env_remove("KONDUCTOR_LOG")
            .stdin(Stdio::null());
        for var in self.sink.env_vars() {
            command.env(var.name, var.value);
        }
        command
    }

    fn run(&self, args: &[&str]) -> Output {
        self.command(args).output().expect("spawn konductor")
    }

    /// Starts `flow view hello-plan --harness fake` and reads its launch line.
    fn view(&self) -> View {
        self.view_with(&["flow", "view", "hello-plan", "--harness", "fake"])
    }

    fn view_with(&self, args: &[&str]) -> View {
        let mut child = self
            .command(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn konductor");
        let stdout = child.stdout.take().unwrap();
        let (tx, rx) = mpsc::channel();
        // The first line is sent at once. Anything after it is kept, so that a second line fails the test.
        let (extra_tx, extra_rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut lines = BufReader::new(stdout).lines();
            let _ = tx.send(lines.next().and_then(Result::ok));
            for line in lines.map_while(Result::ok) {
                let _ = extra_tx.send(line);
            }
        });
        let line = loop {
            if let Some(status) = child.try_wait().unwrap() {
                let mut err = String::new();
                child
                    .stderr
                    .take()
                    .unwrap()
                    .read_to_string(&mut err)
                    .unwrap();
                panic!("flow view ended early with {status}: {err}");
            }
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(Some(line)) => break line,
                Ok(None) => panic!("flow view printed nothing"),
                Err(_) => {}
            }
        };
        let (address, code) = line
            .split_once("/#")
            .expect("a launch address with a fragment");
        let port: u16 = address
            .strip_prefix("http://127.0.0.1:")
            .unwrap_or_else(|| panic!("not a loopback address: {line}"))
            .parse()
            .unwrap();
        View {
            child,
            port,
            code: code.to_string(),
            line,
            extra: extra_rx,
            token: None,
        }
    }
}

struct View {
    child: Child,
    port: u16,
    code: String,
    line: String,
    /// Lines after the first on standard output.
    extra: mpsc::Receiver<String>,
    token: Option<String>,
}

impl View {
    fn call(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
    ) -> (u16, Vec<(String, String)>, String) {
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut head = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n",
            self.port
        );
        if method != "GET" {
            head.push_str(&format!(
                "Origin: http://127.0.0.1:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
                self.port,
                body.unwrap_or("").len()
            ));
        }
        if let Some(token) = &self.token {
            head.push_str(&format!("Authorization: Bearer {token}\r\n"));
        }
        head.push_str("\r\n");
        head.push_str(body.unwrap_or(""));
        stream.write_all(head.as_bytes()).unwrap();
        let mut bytes = Vec::new();
        let _ = stream.read_to_end(&mut bytes);
        let text = String::from_utf8_lossy(&bytes).into_owned();
        let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
        let mut lines = head.split("\r\n");
        let status = lines
            .next()
            .unwrap()
            .split(' ')
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        let headers = lines
            .filter_map(|l| l.split_once(": "))
            .map(|(n, v)| (n.to_ascii_lowercase(), v.to_string()))
            .collect();
        (status, headers, body.to_string())
    }

    fn sign_in(&mut self) -> serde_json::Value {
        let body = format!("{{\"code\":\"{}\"}}", self.code);
        let (status, _, text) = self.call("POST", "/api/session", Some(&body));
        assert_eq!(status, 200, "{text}");
        let json: serde_json::Value = serde_json::from_str(&text).unwrap();
        self.token = json["token"].as_str().map(str::to_string);
        json
    }

    /// Ends the server with a signal and gives the exit status.
    fn stop(mut self, signal: &str) -> std::process::ExitStatus {
        let pid = self.child.id().to_string();
        assert!(Command::new("kill")
            .args([&format!("-{signal}"), &pid])
            .status()
            .unwrap()
            .success());
        let until = Instant::now() + Duration::from_secs(30);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status;
            }
            assert!(Instant::now() < until, "flow view did not stop");
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for View {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn code_of(output: &Output) -> i32 {
    output.status.code().expect("exit code")
}

#[test]
fn view_starts_prints_one_line_answers_the_session_and_ends_on_a_signal() {
    let project = Project::new("start");
    let mut view = project.view();
    assert!(view.line.starts_with("http://127.0.0.1:") && view.line.contains("/#"));
    assert!(view.code.len() >= 32, "a code of at least 128 bits");
    let session = view.sign_in();
    assert_eq!(session["root"], "hello-plan");
    assert_eq!(session["harness"], "fake");
    assert_eq!(session["api_version"], 1);
    // The code works once.
    let again = format!("{{\"code\":\"{}\"}}", view.code);
    assert_eq!(view.call("POST", "/api/session", Some(&again)).0, 401);
    // A run that does not exist, and the loaded workflow.
    let (status, _, body) = view.call("GET", "/api/runs/20261024-0412-a7b3c", None);
    assert_eq!(status, 404, "{body}");
    let (status, _, body) = view.call("GET", "/api/workflow", None);
    assert_eq!(status, 200);
    assert!(body.contains("\"name\":\"hello-plan\""));
    // The page carries the policy header.
    let (status, headers, _) = view.call("GET", "/", None);
    assert_eq!(status, 200);
    let policy = headers
        .iter()
        .find(|(n, _)| n == "content-security-policy")
        .unwrap();
    assert!(policy.1.contains("frame-ancestors 'none'"));
    // The launch code is nowhere in the process list.
    let ps = Command::new("ps").args(["-eo", "args"]).output().unwrap();
    assert!(!String::from_utf8_lossy(&ps.stdout).contains(&view.code));
    // The server holds nothing in the project until a run starts.
    assert!(!project.root.join(".konductor/runs").exists());
    let extra = view.extra.try_recv();
    let status = view.stop("TERM");
    assert_eq!(status.code(), Some(0));
    assert!(extra.is_err(), "only one line on stdout: {extra:?}");
}

#[test]
fn view_ends_with_status_0_on_the_interrupt_signal() {
    let project = Project::new("int");
    let view = project.view();
    assert_eq!(view.stop("INT").code(), Some(0));
}

#[test]
fn view_ends_with_status_0_when_the_terminal_hangs_up() {
    let project = Project::new("hup");
    let view = project.view();
    assert_eq!(view.stop("HUP").code(), Some(0));
}

#[test]
fn a_run_of_an_untrusted_workflow_is_refused_and_a_trusted_one_runs_to_the_end() {
    let project = Project::new("run");
    let mut view = project.view();
    view.sign_in();
    let goal = "{\"params\":{\"goal\":\"Write the plan\"}}";
    let (status, _, body) = view.call("POST", "/api/run", Some(goal));
    assert_eq!(status, 409, "{body}");
    let json: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(json["code"], "trust_required");
    assert!(json["fix"]
        .as_str()
        .unwrap()
        .contains("`konductor flow trust hello-plan`"));

    // The command that the answer names records the trust, and the next run goes.
    let trusted = project.run(&["flow", "trust", "hello-plan", "--yes"]);
    assert_eq!(
        code_of(&trusted),
        0,
        "{}",
        String::from_utf8_lossy(&trusted.stderr)
    );
    let (status, _, body) = view.call("POST", "/api/run", Some(goal));
    assert_eq!(status, 202, "{body}");
    let run_id = serde_json::from_str::<serde_json::Value>(&body).unwrap()["run_id"]
        .as_str()
        .unwrap()
        .to_string();
    let until = Instant::now() + Duration::from_secs(30);
    let run = loop {
        let (status, _, body) = view.call("GET", &format!("/api/runs/{run_id}"), None);
        assert_eq!(status, 200, "{body}");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        if json["run"]["status"] != "running" {
            break json["run"].clone();
        }
        assert!(Instant::now() < until, "the run never ended");
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(run["status"], "passed", "{run}");
    assert_eq!(run["harness"], "fake");
    // The run state is where `flow run` keeps it, and git ignores it.
    assert!(project
        .root
        .join(format!(".konductor/runs/{run_id}/state.json"))
        .is_file());
    let ignore = std::fs::read_to_string(project.root.join(".konductor/.gitignore")).unwrap();
    assert!(ignore.lines().any(|l| l == "runs/"));
    // A save that changes the bytes ends the trust: the next run needs it again.
    let (_, _, loaded) = view.call("GET", "/api/workflow", None);
    let loaded: serde_json::Value = serde_json::from_str(&loaded).unwrap();
    // Even a comment changes the bytes, and any change ends the trust.
    let text = format!(
        "{}# edited in the canvas\n",
        loaded["text"].as_str().unwrap()
    );
    let save = serde_json::json!({"text": text, "base_hash": loaded["hash"]}).to_string();
    let (status, _, body) = view.call("PUT", "/api/workflow", Some(&save));
    assert_eq!(status, 200, "{body}");
    let (status, _, body) = view.call("POST", "/api/run", Some(goal));
    assert_eq!(status, 409, "{body}");
    assert!(body.contains("trust_required"));
}

/// Whether a process still runs. A zombie that nobody has reaped yet does not count.
fn alive(pid: u32) -> bool {
    let output = Command::new("/bin/ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .output()
        .expect("run ps");
    let stat = String::from_utf8_lossy(&output.stdout);
    let stat = stat.trim();
    !stat.is_empty() && !stat.starts_with('Z')
}

/// A real session, not the fake harness: the stand-in `kiro-cli` writes its process id and sleeps. The signal that
/// stops the server must end that session before the server exits, and the run must read as halted.
#[test]
fn a_signal_ends_the_live_session_of_a_run_and_the_server_exits_0() {
    use std::os::unix::fs::PermissionsExt;
    let project = Project::new("live");
    for agent in ["k-architect", "k-developer"] {
        let file = project.root.join(format!(".kiro/agents/{agent}.json"));
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(
            &file,
            format!(r#"{{"name":"{agent}","allowedTools":["fs_read","fs_write"]}}"#),
        )
        .unwrap();
    }
    let pid_file = project
        .root
        .join("..")
        .join(format!("live-session-{}.pid", std::process::id()));
    let program = project.programs.join("kiro-cli");
    std::fs::write(
        &program,
        format!(
            "#!/bin/sh\necho $$ > '{}'\nexec sleep 120\n",
            pid_file.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
    let trusted = project.run(&["flow", "trust", "hello-plan", "--yes"]);
    assert_eq!(
        code_of(&trusted),
        0,
        "{}",
        String::from_utf8_lossy(&trusted.stderr)
    );

    let mut view = project.view_with(&["flow", "view", "hello-plan", "--harness", "kiro-cli"]);
    view.sign_in();
    let goal = "{\"params\":{\"goal\":\"Write the plan\"}}";
    let (status, _, body) = view.call("POST", "/api/run", Some(goal));
    assert_eq!(status, 202, "{body}");
    let run_id = serde_json::from_str::<serde_json::Value>(&body).unwrap()["run_id"]
        .as_str()
        .unwrap()
        .to_string();
    let until = Instant::now() + Duration::from_secs(30);
    let session = loop {
        if let Some(pid) = std::fs::read_to_string(&pid_file)
            .ok()
            .and_then(|text| text.trim().parse::<u32>().ok())
        {
            break pid;
        }
        assert!(Instant::now() < until, "the session never started");
        std::thread::sleep(Duration::from_millis(25));
    };
    assert!(alive(session));

    assert_eq!(view.stop("INT").code(), Some(0));
    let until = Instant::now() + Duration::from_secs(10);
    while alive(session) {
        assert!(Instant::now() < until, "the session outlived the server");
        std::thread::sleep(Duration::from_millis(25));
    }
    let state = std::fs::read_to_string(
        project
            .root
            .join(format!(".konductor/runs/{run_id}/state.json")),
    )
    .unwrap();
    let state: serde_json::Value = serde_json::from_str(&state).unwrap();
    assert_eq!(state["status"], "halted", "{state}");
}

/// A session that ignores the terminate signal keeps the first stop waiting. The second signal then runs the default
/// action, so the server dies from it instead of waiting out the grace period.
#[test]
fn a_second_signal_ends_the_server_while_the_first_still_waits_for_a_session() {
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::process::ExitStatusExt;
    let project = Project::new("twice");
    for agent in ["k-architect", "k-developer"] {
        let file = project.root.join(format!(".kiro/agents/{agent}.json"));
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(
            &file,
            format!(r#"{{"name":"{agent}","allowedTools":["fs_read","fs_write"]}}"#),
        )
        .unwrap();
    }
    let pid_file = project
        .root
        .join("..")
        .join(format!("twice-session-{}.pid", std::process::id()));
    let program = project.programs.join("kiro-cli");
    std::fs::write(
        &program,
        format!(
            "#!/bin/sh\ntrap '' TERM INT HUP\necho $$ > '{}'\nwhile :; do sleep 1; done\n",
            pid_file.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
    let trusted = project.run(&["flow", "trust", "hello-plan", "--yes"]);
    assert_eq!(code_of(&trusted), 0);

    let mut view = project.view_with(&["flow", "view", "hello-plan", "--harness", "kiro-cli"]);
    view.sign_in();
    let goal = "{\"params\":{\"goal\":\"Write the plan\"}}";
    let (status, _, body) = view.call("POST", "/api/run", Some(goal));
    assert_eq!(status, 202, "{body}");
    let until = Instant::now() + Duration::from_secs(30);
    let session = loop {
        if let Some(pid) = std::fs::read_to_string(&pid_file)
            .ok()
            .and_then(|text| text.trim().parse::<u32>().ok())
        {
            break pid;
        }
        assert!(Instant::now() < until, "the session never started");
        std::thread::sleep(Duration::from_millis(25));
    };
    // The launcher runs the program under `timeout`, so the stand-in is not the leader of its group.
    let group = Command::new("/bin/ps")
        .args(["-o", "pgid=", "-p", &session.to_string()])
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .unwrap_or_default();
    let pid = view.child.id().to_string();
    let send = |signal: &str| {
        assert!(Command::new("kill")
            .args([&format!("-{signal}"), &pid])
            .status()
            .unwrap()
            .success());
    };
    send("INT");
    std::thread::sleep(Duration::from_millis(300));
    assert!(
        view.child.try_wait().unwrap().is_none(),
        "the server did not wait for the session"
    );
    send("INT");
    let until = Instant::now() + Duration::from_secs(10);
    let status = loop {
        if let Some(status) = view.child.try_wait().unwrap() {
            break status;
        }
        assert!(
            Instant::now() < until,
            "the second signal did not end the server"
        );
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(status.signal(), Some(2), "{status:?}");
    // The session ignores the signals that ended the server, so end its group here.
    if !group.is_empty() {
        let _ = Command::new("kill")
            .args(["-KILL", "--", &format!("-{group}")])
            .status();
    }
}

/// A tool configuration entry that the scan refuses (a link to a folder) names its path in the text of `flow trust`.
/// The canvas never gets that text: a run answers `trust_required` with the generic command, and nothing in the answer
/// holds a path of the machine.
#[test]
fn a_refused_tool_configuration_entry_reaches_the_browser_as_a_plain_trust_required() {
    let project = Project::new("refused-config");
    // Trusted first, so that only the refused entry can be the reason for the answer.
    let trusted = project.run(&["flow", "trust", "hello-plan", "--yes"]);
    assert_eq!(
        code_of(&trusted),
        0,
        "{}",
        String::from_utf8_lossy(&trusted.stderr)
    );
    let target = project.root.join("somewhere");
    std::fs::create_dir_all(&target).unwrap();
    std::os::unix::fs::symlink(&target, project.root.join(".mcp.json")).unwrap();
    let mut view = project.view();
    view.sign_in();
    let goal = "{\"params\":{\"goal\":\"Write the plan\"}}";
    let (status, _, body) = view.call("POST", "/api/run", Some(goal));
    assert_eq!(status, 409, "{body}");
    let json: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(json["code"], "trust_required");
    assert!(json["fix"]
        .as_str()
        .unwrap()
        .contains("`konductor flow trust hello-plan`"));
    for secret in [
        project.root.to_str().unwrap(),
        project.home.to_str().unwrap(),
        ".mcp.json",
        "somewhere",
    ] {
        assert!(!body.contains(secret), "{secret} is in {body}");
    }
}

#[test]
fn a_workflow_with_errors_still_starts_the_server() {
    let project = Project::new("errors");
    std::fs::write(
        project.root.join(".konductor/workflows/hello-plan.yml"),
        "format: konductor/2\n",
    )
    .unwrap();
    let mut view = project.view();
    view.sign_in();
    let (status, _, body) = view.call("GET", "/api/workflow", None);
    assert_eq!(status, 200);
    assert!(
        body.contains("UNSUPPORTED_FORMAT") && body.contains("MISSING_KEY"),
        "{body}"
    );
    let (status, _, body) = view.call("POST", "/api/run", Some("{\"params\":{\"goal\":\"x\"}}"));
    assert_eq!(status, 422, "{body}");
}

#[test]
fn a_home_that_is_unset_does_not_stop_the_view_and_a_run_needs_trust() {
    let project = Project::new("nohome");
    let mut command = project.command(&["flow", "view", "hello-plan", "--harness", "fake"]);
    command
        .env_remove("HOME")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let port: u16 = line
        .trim()
        .strip_prefix("http://127.0.0.1:")
        .and_then(|r| r.split('/').next())
        .unwrap()
        .parse()
        .unwrap();
    let code = line.trim().split("/#").nth(1).unwrap().to_string();
    let (_keep, extra) = mpsc::channel();
    let mut view = View {
        child,
        port,
        code,
        line,
        extra,
        token: None,
    };
    view.sign_in();
    let (status, _, body) = view.call("POST", "/api/run", Some("{\"params\":{\"goal\":\"x\"}}"));
    assert_eq!(status, 409, "{body}");
    assert!(body.contains("trust_required"));
    // The fix says what is missing, and not a command that would fail without a home folder.
    let fix = serde_json::from_str::<serde_json::Value>(&body).unwrap()["fix"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(fix.contains("HOME") && !fix.contains('`'), "{fix}");
}

#[test]
fn a_workflow_that_is_not_in_a_project_is_refused_a_run_and_never_trusted() {
    let project = Project::new("loose");
    // The workflow lives in the home folder. The working folder is a git repository with no `.konductor` folder, so
    // `flow run` would refuse it.
    let user_folder = project.home.join(".konductor/workflows");
    std::fs::create_dir_all(&user_folder).unwrap();
    std::fs::rename(
        project.root.join(".konductor/workflows/hello-plan.yml"),
        user_folder.join("hello-plan.yml"),
    )
    .unwrap();
    std::fs::remove_dir_all(project.root.join(".konductor")).unwrap();
    std::fs::create_dir(project.root.join(".git")).unwrap();
    let flow_run = project.run(&["flow", "run", "hello-plan", "--harness", "fake"]);
    assert_eq!(code_of(&flow_run), 64, "flow run refuses it first");
    let mut view = project.view();
    view.sign_in();
    let (status, _, body) = view.call("POST", "/api/run", Some("{\"params\":{\"goal\":\"x\"}}"));
    assert_eq!(status, 409, "{body}");
    let json: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(json["code"], "trust_required");
    let fix = json["fix"].as_str().unwrap();
    assert!(fix.contains("project") && !fix.contains('`'), "{fix}");
    // Nothing ran, and nothing was made in the working folder.
    assert!(!project.root.join(".konductor").exists());
}

#[test]
fn usage_errors_exit_64() {
    let project = Project::new("usage");
    for (args, why) in [
        (
            vec!["flow", "view", "library/hello", "--harness", "fake"],
            "a shipped workflow",
        ),
        (
            vec!["flow", "view", "nothing-here", "--harness", "fake"],
            "a missing file",
        ),
        (
            vec!["flow", "view", "hello-plan"],
            "no harness and none installed",
        ),
        (
            vec!["flow", "view", "hello-plan", "--harness", "bogus"],
            "a harness that is not one",
        ),
        (
            vec!["flow", "view", "Bad_Name", "--harness", "fake"],
            "a bad name",
        ),
    ] {
        let output = project.run(&args);
        assert_eq!(
            code_of(&output),
            64,
            "{why}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let output = project.run(&["flow", "view", "library/hello", "--harness", "fake"]);
    assert!(String::from_utf8_lossy(&output.stderr)
        .contains("Shipped workflows (`library/<name>`) are not available yet."));
    // `fake` with no script is a usage error as well.
    let mut command = project.command(&["flow", "view", "hello-plan", "--harness", "fake"]);
    command.env_remove("KONDUCTOR_FAKE_SCRIPT");
    assert_eq!(code_of(&command.output().unwrap()), 64);
}

#[test]
fn a_missing_page_folder_exits_74_and_names_the_variable_and_the_build_command() {
    let project = Project::new("nopage");
    let mut command = project.command(&["flow", "view", "hello-plan", "--harness", "fake"]);
    command.env("KONDUCTOR_CANVAS_DIR", project.root.join("no-such-folder"));
    let output = command.output().unwrap();
    assert_eq!(code_of(&output), 74);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("KONDUCTOR_CANVAS_DIR") && stderr.contains("npm run build"),
        "{stderr}"
    );
}

/// A copy of the binary with a `dist/` next to it, as an install would have, and the command to run it. The page
/// folder variable is not set unless a test sets it.
struct Installed {
    program: PathBuf,
    dist: PathBuf,
}

impl Installed {
    fn new(project: &Project, label: &str) -> Installed {
        use std::os::unix::fs::PermissionsExt;
        let folder = scratch_dir(&format!("{label}-install"));
        let program = folder.join("konductor");
        std::fs::copy(bin(), &program).unwrap();
        let dist = folder.join("dist");
        std::fs::create_dir_all(dist.join("assets")).unwrap();
        std::fs::write(dist.join("index.html"), "<html></html>").unwrap();
        std::fs::write(dist.join("assets/app.js"), "x").unwrap();
        for (path, mode) in [
            (dist.clone(), 0o755),
            (dist.join("assets"), 0o755),
            (dist.join("index.html"), 0o644),
            (dist.join("assets/app.js"), 0o644),
        ] {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
        }
        let _ = project;
        Installed { program, dist }
    }

    fn mode(&self, relative: &str, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        let path = if relative.is_empty() {
            self.dist.clone()
        } else {
            self.dist.join(relative)
        };
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
    }

    fn command(&self, project: &Project) -> Command {
        let mut command = Command::new(&self.program);
        command
            .args(["flow", "view", "hello-plan", "--harness", "fake"])
            .current_dir(&project.root)
            .env("HOME", &project.home)
            .env("KONDUCTOR_FAKE_SCRIPT", &project.script)
            .env_remove("KONDUCTOR_CANVAS_DIR")
            .stdin(Stdio::null());
        for var in project.sink.env_vars() {
            command.env(var.name, var.value);
        }
        command
    }

    /// Starts it and gives its first line of output, or its status and error text if it ends first.
    fn start(mut command: Command) -> Result<String, (i32, String)> {
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        // A program that was just written can look busy while another test thread forks, until that fork has done
        // its exec. The open is tried again.
        let mut attempts = 0;
        let mut child = loop {
            match command.spawn() {
                Ok(child) => break child,
                Err(e) if e.raw_os_error() == Some(26) && attempts < 100 => {
                    attempts += 1;
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(e) => panic!("spawn: {e}"),
            }
        };
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        if line.is_empty() {
            let mut error = String::new();
            child
                .stderr
                .take()
                .unwrap()
                .read_to_string(&mut error)
                .unwrap();
            let status = child.wait().unwrap();
            return Err((status.code().unwrap(), error));
        }
        let _ = child.kill();
        let _ = child.wait();
        Ok(line)
    }
}

#[test]
fn a_page_folder_next_to_the_program_that_every_user_can_write_to_is_refused() {
    let project = Project::new("dist");
    let installed = Installed::new(&project, "dist");
    // The folder, a folder in it, the index and another file: each is enough, and none is served.
    for relative in ["", "assets", "index.html", "assets/app.js"] {
        installed.mode(relative, if relative.contains('.') { 0o666 } else { 0o777 });
        let (code, error) = Installed::start(installed.command(&project)).expect_err(relative);
        assert_eq!(code, 74, "{relative}: {error}");
        assert!(
            error.contains("every user") && error.contains("KONDUCTOR_CANVAS_DIR"),
            "{error}"
        );
        installed.mode(relative, if relative.contains('.') { 0o644 } else { 0o755 });
    }
    // A group-writable folder is the normal result of a build with a umask of 002.
    installed.mode("", 0o775);
    installed.mode("index.html", 0o664);
    let line = Installed::start(installed.command(&project)).expect("it starts");
    assert!(line.starts_with("http://127.0.0.1:"), "{line}");
}

#[test]
fn the_page_folder_variable_skips_the_check_of_the_folder_next_to_the_program() {
    let project = Project::new("dist-var");
    let installed = Installed::new(&project, "dist-var");
    installed.mode("", 0o777);
    let mut command = installed.command(&project);
    command.env("KONDUCTOR_CANVAS_DIR", &installed.dist);
    let line = Installed::start(command).expect("a folder that the user names is not checked");
    assert!(line.starts_with("http://127.0.0.1:"), "{line}");
}

#[test]
fn a_workflow_in_the_home_folder_is_refused_a_run_and_the_fix_says_to_use_a_project() {
    let mut project = Project::new("ishome");
    // The working folder is the home folder, which is a git folder: `flow run` would refuse that root.
    project.root = project.home.clone();
    std::fs::create_dir_all(project.home.join(".konductor/workflows")).unwrap();
    std::fs::write(
        project.home.join(".konductor/workflows/hello-plan.yml"),
        hello_plan(),
    )
    .unwrap();
    std::fs::create_dir(project.home.join(".git")).unwrap();
    let mut view = project.view();
    view.sign_in();
    let (status, _, body) = view.call("POST", "/api/run", Some("{\"params\":{\"goal\":\"x\"}}"));
    assert_eq!(status, 409, "{body}");
    let json: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(json["code"], "trust_required");
    let fix = json["fix"].as_str().unwrap();
    assert!(
        fix.contains("home folder") && fix.contains("project") && !fix.contains('`'),
        "{fix}"
    );
}
