// SPDX-License-Identifier: Apache-2.0
//
// reload_skills_shakedown.rs — targeted regression coverage for the
// `reload_skills` MCP tool after the `rmcp` 0.1.5 -> 2.1.0 bump.
//
// `initialize_handshake.rs` and `full_tool_surface.rs` already prove
// `reload_skills` succeeds once, mirrors its scan diagnostic to stderr,
// and reports matching total/filtered/effective counts when a filter is
// active. What they do not cover: rejecting unexpected arguments, calling
// `reload_skills` more than once in one session, `reload_skills`
// actually detecting a file added or removed on disk *between* calls
// (not just re-reporting whatever the process indexed at startup), an
// empty configured directory being a valid zero-skill state (not an
// error), and a filter that matches nothing reporting `indexed: 0` with
// every seeded skill counted as filtered out. This file is deliberately
// self-contained: the spawn/write/read-line JSON-RPC framing helpers
// below are copied verbatim from `full_tool_surface.rs` /
// `find_skills_shakedown.rs` rather than shared, matching those files'
// own stated pattern (each integration-test binary in this crate is
// independently runnable and carries its own copies).

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::timeout;

const IO_TIMEOUT: Duration = Duration::from_secs(10);

/// Spawns `skill-lookup-mcp` against `skills_dir` (optionally with
/// `--skill-name-filter filter`), with `HOME` explicitly unset on the
/// child process so the server's default-root fallback
/// (`~/.konductor/skills/`) can never contribute skills this test didn't
/// seed itself — only the explicit `--skills-dir` counts. `sink`'s own
/// env vars redirect this server's telemetry to the loopback fixture --
/// every tool call increments its counters, flushed on shutdown.
fn spawn_server(
    skills_dir: &Path,
    filter: Option<&str>,
    sink: &telemetry_test_sink::TelemetrySink,
) -> Child {
    let bin = env!("CARGO_BIN_EXE_skill-lookup-mcp");
    let mut command = Command::new(bin);
    command
        .arg("--skills-dir")
        .arg(skills_dir)
        .env_remove("HOME");
    if let Some(f) = filter {
        command.arg("--skill-name-filter").arg(f);
    }
    for var in sink.env_vars() {
        command.env(var.name, &var.value);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .expect("failed to spawn skill-lookup-mcp")
}

/// Writes one JSON-RPC message (request or notification) as a single
/// line to `stdin`, flushing afterward. Bounded by `IO_TIMEOUT` so a
/// blocked write fails fast instead of hanging the test.
async fn write_message(stdin: &mut tokio::process::ChildStdin, message: &serde_json::Value) {
    let mut line = serde_json::to_string(message).expect("serialize JSON-RPC message");
    line.push('\n');
    timeout(IO_TIMEOUT, stdin.write_all(line.as_bytes()))
        .await
        .expect("timed out writing JSON-RPC message")
        .expect("failed to write JSON-RPC message to child stdin");
    timeout(IO_TIMEOUT, stdin.flush())
        .await
        .expect("timed out flushing child stdin")
        .expect("failed to flush child stdin");
}

/// Reads one line from `reader` and parses it as JSON, bounded by
/// `IO_TIMEOUT`. Used for reading exactly one response per request sent,
/// matching this test's one-write-then-one-read call pattern (never
/// relying on response ordering beyond that).
async fn read_json_line<R: tokio::io::AsyncBufRead + Unpin>(reader: &mut R) -> serde_json::Value {
    let mut line = String::new();
    timeout(IO_TIMEOUT, reader.read_line(&mut line))
        .await
        .expect("timed out waiting for a response line")
        .expect("failed to read a response line from child stdout");
    assert!(
        !line.trim().is_empty(),
        "expected a non-empty JSON-RPC response line"
    );
    serde_json::from_str(line.trim()).expect("response line was not valid JSON")
}

/// Completes the `initialize` / `notifications/initialized` handshake on
/// an already-spawned child, asserting the `initialize` call succeeded.
/// Every other request in this file is sent only after this returns, so
/// the server is past its "must be initialized" phase before any tool
/// call is attempted.
async fn complete_handshake<R: tokio::io::AsyncBufRead + Unpin>(
    stdin: &mut tokio::process::ChildStdin,
    reader: &mut R,
) {
    write_message(
        stdin,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "reload-skills-shakedown-test", "version": "0.0.0"}
            }
        }),
    )
    .await;
    let response = read_json_line(reader).await;
    assert!(
        response.get("result").is_some(),
        "expected initialize to succeed: {response:?}"
    );

    write_message(
        stdin,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }),
    )
    .await;
}

/// Writes one skill's `SKILL.md` under `<dir>/<name>/SKILL.md`, matching
/// the frontmatter shape `full_tool_surface.rs`/`find_skills_shakedown.rs`
/// already use.
fn write_skill(dir: &Path, name: &str, description: &str) {
    let skill_dir = dir.join(name);
    std::fs::create_dir_all(&skill_dir).expect("create skill dir");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: {description}\n---\n\nBody text for {name}.\n"),
    )
    .expect("write SKILL.md");
}

/// Fresh, process- and clock-unique temp directory, matching the
/// `label`-disambiguated naming convention `full_tool_surface.rs`'s
/// `seed_probe_skill_dir` and `find_skills_shakedown.rs`'s
/// `seed_multi_skill_dir` both use (pid + nanos alone is not always
/// enough to disambiguate two tests starting in the same clock tick).
fn fresh_temp_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "skill-lookup-reload-shakedown-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time before UNIX epoch")
            .as_nanos()
    ));
    dir
}

/// Removes its wrapped temp directory on drop, including during panic
/// unwind — so a failing test's assertion still cleans up instead of
/// leaking the directory (the child process itself is already handled
/// via `kill_on_drop(true)` on spawn).
struct TempDirGuard(std::path::PathBuf);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Runs `body(stdin, reader, dir)` against a freshly spawned server over
/// `dir` (already seeded by the caller, or intentionally empty), then
/// tears both down: closes stdin, drains stderr for diagnostics, waits
/// for clean exit, and removes the temp dir. `dir` is handed to `body`
/// so tests that add/remove files between calls can write directly into
/// the same directory the running server was pointed at.
async fn with_server<F, Fut>(dir: std::path::PathBuf, filter: Option<&str>, body: F)
where
    F: FnOnce(
        tokio::process::ChildStdin,
        BufReader<tokio::process::ChildStdout>,
        std::path::PathBuf,
    ) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let guard = TempDirGuard(dir.clone());
    let sink = telemetry_test_sink::TelemetrySink::start();
    let mut child = spawn_server(&dir, filter, &sink);

    let stdin = child.stdin.take().expect("child stdin not piped");
    let stdout = child.stdout.take().expect("child stdout not piped");
    let reader = BufReader::new(stdout);

    body(stdin, reader, dir).await;

    use tokio::io::AsyncReadExt;
    let mut stderr = child.stderr.take().expect("child stderr not piped");
    let mut stderr_buf = String::new();
    let _ = timeout(IO_TIMEOUT, stderr.read_to_string(&mut stderr_buf)).await;
    let status = timeout(IO_TIMEOUT, child.wait())
        .await
        .expect("timed out waiting for skill-lookup-mcp to exit")
        .expect("failed to wait on child process");
    assert!(
        status.success(),
        "skill-lookup-mcp did not exit cleanly: {status:?} (stderr: {stderr_buf})"
    );

    drop(guard);
}

/// Sends one `tools/call` for `reload_skills` with `arguments`, id
/// `id`, and returns the raw JSON-RPC response (so both success and
/// error cases can be asserted on by the caller).
async fn call_reload_skills<R: tokio::io::AsyncBufRead + Unpin>(
    stdin: &mut tokio::process::ChildStdin,
    reader: &mut R,
    id: i64,
    arguments: serde_json::Value,
) -> serde_json::Value {
    write_message(
        stdin,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": {"name": "reload_skills", "arguments": arguments}
        }),
    )
    .await;
    let response = read_json_line(reader).await;
    assert_eq!(
        response.get("id").and_then(|v| v.as_i64()),
        Some(id),
        "reload_skills response did not echo request id {id}: {response:?}"
    );
    response
}

/// Sends one `tools/call` for `find_skills` with no filters, id `id`,
/// and returns the parsed record names.
async fn call_find_skills_names<R: tokio::io::AsyncBufRead + Unpin>(
    stdin: &mut tokio::process::ChildStdin,
    reader: &mut R,
    id: i64,
) -> Vec<String> {
    write_message(
        stdin,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": {"name": "find_skills", "arguments": {}}
        }),
    )
    .await;
    let response = read_json_line(reader).await;
    assert_eq!(
        response.get("id").and_then(|v| v.as_i64()),
        Some(id),
        "find_skills response did not echo request id {id}: {response:?}"
    );
    let result = response
        .get("result")
        .unwrap_or_else(|| panic!("expected find_skills to succeed: {response:?}"));
    let content_text = result["content"][0]["text"]
        .as_str()
        .expect("expected a text content item in the find_skills result");
    let records: Vec<serde_json::Value> =
        serde_json::from_str(content_text).expect("find_skills content was not a JSON array");
    records
        .iter()
        .filter_map(|r| r.get("name").and_then(|v| v.as_str()).map(str::to_string))
        .collect()
}

/// Sends one `tools/call` for `get_skill` with the given `name`, id
/// `id`, and returns the raw JSON-RPC response.
async fn call_get_skill<R: tokio::io::AsyncBufRead + Unpin>(
    stdin: &mut tokio::process::ChildStdin,
    reader: &mut R,
    id: i64,
    name: &str,
) -> serde_json::Value {
    write_message(
        stdin,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": {"name": "get_skill", "arguments": {"name": name}}
        }),
    )
    .await;
    let response = read_json_line(reader).await;
    assert_eq!(
        response.get("id").and_then(|v| v.as_i64()),
        Some(id),
        "get_skill response did not echo request id {id}: {response:?}"
    );
    response
}

/// Extracts `(indexed, filtered_out)` from a successful `reload_skills`
/// response, panicking with the full response on any shape mismatch.
fn parse_reload_counts(response: &serde_json::Value) -> (u64, u64) {
    let result = response
        .get("result")
        .unwrap_or_else(|| panic!("expected reload_skills to succeed: {response:?}"));
    let content_text = result["content"][0]["text"]
        .as_str()
        .expect("expected a text content item in the reload_skills result");
    let body: serde_json::Value =
        serde_json::from_str(content_text).expect("reload_skills content was not valid JSON");
    let indexed = body["indexed"]
        .as_u64()
        .unwrap_or_else(|| panic!("expected an 'indexed' field: {body:?}"));
    let filtered_out = body["filtered_out"]
        .as_u64()
        .unwrap_or_else(|| panic!("expected a 'filtered_out' field: {body:?}"));
    (indexed, filtered_out)
}

// ─────────────────────────────────────────────────────────────────────
// 1. Unexpected arguments must be rejected.
// ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn reload_skills_rejects_unexpected_arguments() {
    let dir = fresh_temp_dir("unexpected-args");
    std::fs::create_dir_all(&dir).expect("create fixture root");
    write_skill(
        &dir,
        "probe-skill",
        "Probe skill for the unexpected-args test.",
    );

    with_server(dir, None, |mut stdin, mut reader, _dir| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        let response = call_reload_skills(
            &mut stdin,
            &mut reader,
            2,
            serde_json::json!({"foo": "bar"}),
        )
        .await;

        assert!(
            response.get("result").is_none(),
            "an unexpected argument must not succeed: {response:?}"
        );
        let error = response.get("error").unwrap_or_else(|| {
            panic!("expected a JSON-RPC error for an unexpected argument: {response:?}")
        });
        let message = error
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("expected an error message: {error:?}"));
        assert!(
            message.contains("unknown parameter"),
            "expected the rejection message to mention 'unknown parameter', got: {message:?} (full error: {error:?})"
        );
        assert!(
            message.contains("foo"),
            "expected the rejection message to name the offending key 'foo', got: {message:?}"
        );

        drop(stdin);
    })
    .await;
}

// ─────────────────────────────────────────────────────────────────────
// 2. Calling reload_skills twice in one session must both succeed with
//    identical counts, and must not hang, error, or double-count.
// ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn reload_skills_called_twice_in_one_session_both_succeed() {
    let dir = fresh_temp_dir("called-twice");
    std::fs::create_dir_all(&dir).expect("create fixture root");
    write_skill(
        &dir,
        "probe-skill",
        "Probe skill for the called-twice test.",
    );

    with_server(dir, None, |mut stdin, mut reader, _dir| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        let first = call_reload_skills(&mut stdin, &mut reader, 2, serde_json::json!({})).await;
        assert!(
            first.get("result").is_some(),
            "expected the first reload_skills call to succeed: {first:?}"
        );
        let (first_indexed, first_filtered_out) = parse_reload_counts(&first);

        let second = call_reload_skills(&mut stdin, &mut reader, 3, serde_json::json!({})).await;
        assert!(
            second.get("result").is_some(),
            "expected the second reload_skills call to succeed: {second:?}"
        );
        let (second_indexed, second_filtered_out) = parse_reload_counts(&second);

        assert_eq!(
            first_indexed, 1,
            "expected exactly 1 indexed skill on the first call: {first:?}"
        );
        assert_eq!(
            (first_indexed, first_filtered_out),
            (second_indexed, second_filtered_out),
            "an unchanged directory reloaded twice must report identical counts both times \
             (first: indexed={first_indexed}, filtered_out={first_filtered_out}; \
             second: indexed={second_indexed}, filtered_out={second_filtered_out})"
        );

        drop(stdin);
    })
    .await;
}

// ─────────────────────────────────────────────────────────────────────
// 3. reload_skills must detect a file added to disk between calls —
//    proving it re-scans disk, not cached state.
// ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn reload_skills_detects_a_file_added_between_calls() {
    let dir = fresh_temp_dir("file-added");
    std::fs::create_dir_all(&dir).expect("create fixture root");
    write_skill(
        &dir,
        "original-skill",
        "Seeded before the server ever starts.",
    );

    with_server(dir, None, |mut stdin, mut reader, dir| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        let baseline = call_reload_skills(&mut stdin, &mut reader, 2, serde_json::json!({})).await;
        let (baseline_indexed, baseline_filtered_out) = parse_reload_counts(&baseline);
        assert_eq!(
            baseline_indexed, 1,
            "expected exactly 1 indexed skill before adding a new file: {baseline:?}"
        );
        assert_eq!(baseline_filtered_out, 0);

        // Write a second, brand-new skill directly to disk while the
        // server process is still running — this is the change
        // reload_skills must pick up.
        write_skill(
            &dir,
            "newly-added-skill",
            "Written to disk after the server started.",
        );

        let after_add = call_reload_skills(&mut stdin, &mut reader, 3, serde_json::json!({})).await;
        let (after_add_indexed, after_add_filtered_out) = parse_reload_counts(&after_add);
        assert_eq!(
            after_add_indexed, 2,
            "expected reload_skills to detect the newly added file and report 2 indexed \
             skills, got response: {after_add:?}"
        );
        assert_eq!(after_add_filtered_out, 0);

        // find_skills must also now see the new skill — proving the
        // reload actually rebuilt the queryable index, not just the
        // diagnostic counters.
        let mut names = call_find_skills_names(&mut stdin, &mut reader, 4).await;
        names.sort_unstable();
        assert_eq!(
            names,
            vec![
                "newly-added-skill".to_string(),
                "original-skill".to_string()
            ],
            "expected find_skills to return both skills after reload, got: {names:?}"
        );

        drop(stdin);
    })
    .await;
}

// ─────────────────────────────────────────────────────────────────────
// 4. reload_skills must detect a file removed from disk between calls.
// ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn reload_skills_detects_a_file_removed_between_calls() {
    let dir = fresh_temp_dir("file-removed");
    std::fs::create_dir_all(&dir).expect("create fixture root");
    write_skill(&dir, "keeper-skill", "Stays on disk for the whole test.");
    write_skill(&dir, "doomed-skill", "Removed from disk mid-session.");

    with_server(dir, None, |mut stdin, mut reader, dir| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        let baseline = call_reload_skills(&mut stdin, &mut reader, 2, serde_json::json!({})).await;
        let (baseline_indexed, baseline_filtered_out) = parse_reload_counts(&baseline);
        assert_eq!(
            baseline_indexed, 2,
            "expected exactly 2 indexed skills before removing one: {baseline:?}"
        );
        assert_eq!(baseline_filtered_out, 0);

        // Remove one skill's directory directly from disk while the
        // server process is still running.
        std::fs::remove_dir_all(dir.join("doomed-skill"))
            .expect("remove doomed-skill directory from disk");

        let after_remove =
            call_reload_skills(&mut stdin, &mut reader, 3, serde_json::json!({})).await;
        let (after_remove_indexed, after_remove_filtered_out) = parse_reload_counts(&after_remove);
        assert_eq!(
            after_remove_indexed, 1,
            "expected reload_skills to detect the removed file and report 1 indexed skill, \
             got response: {after_remove:?}"
        );
        assert_eq!(after_remove_filtered_out, 0);

        // find_skills must no longer return the removed skill.
        let names = call_find_skills_names(&mut stdin, &mut reader, 4).await;
        assert_eq!(
            names,
            vec!["keeper-skill".to_string()],
            "expected find_skills to no longer list the removed skill, got: {names:?}"
        );

        // get_skill for the removed name must now report not-found.
        let get_response = call_get_skill(&mut stdin, &mut reader, 5, "doomed-skill").await;
        assert!(
            get_response.get("result").is_none(),
            "expected get_skill for a removed skill to fail after reload: {get_response:?}"
        );
        let error = get_response.get("error").unwrap_or_else(|| {
            panic!("expected a JSON-RPC error for the removed skill: {get_response:?}")
        });
        let message = error
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("expected an error message: {error:?}"));
        assert!(
            message.contains("skill not found"),
            "expected a 'skill not found' message for the removed skill, got: {message:?}"
        );

        drop(stdin);
    })
    .await;
}

// ─────────────────────────────────────────────────────────────────────
// 5. reload_skills against an empty (but existing) directory must
//    succeed with indexed: 0, not error.
// ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn reload_skills_on_empty_directory_reports_zero_indexed() {
    let dir = fresh_temp_dir("empty-dir");
    // Create the directory itself but seed zero skill files in it — an
    // existing, empty --skills-dir is a valid configuration, distinct
    // from a --skills-dir that doesn't exist at all (which fails
    // validation at startup instead).
    std::fs::create_dir_all(&dir).expect("create empty fixture root");

    with_server(dir, None, |mut stdin, mut reader, _dir| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        let response = call_reload_skills(&mut stdin, &mut reader, 2, serde_json::json!({})).await;
        assert!(
            response.get("result").is_some(),
            "expected reload_skills against an empty directory to succeed, not error: {response:?}"
        );
        let (indexed, filtered_out) = parse_reload_counts(&response);
        assert_eq!(
            indexed, 0,
            "expected 0 indexed skills for an empty directory: {response:?}"
        );
        assert_eq!(
            filtered_out, 0,
            "expected 0 filtered_out with no filter active and nothing to filter: {response:?}"
        );

        drop(stdin);
    })
    .await;
}

// ─────────────────────────────────────────────────────────────────────
// 6. reload_skills with a --skill-name-filter matching none of the
//    seeded skills must succeed with indexed: 0 and filtered_out equal
//    to the total seeded count — success, not an error.
// ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn reload_skills_with_no_matching_filter_reports_zero_effective() {
    // `--skill-name-filter` only ever removes a skill the install
    // manifest says konductor itself installed (see
    // `scanner::apply_name_filter`'s doc comment, and the identical
    // setup in initialize_handshake.rs's own
    // `reload_skills_with_filter_reports_total_filtered_and_effective_counts_in_stderr`
    // test) — a skill with no manifest entry always survives the filter
    // regardless of its value. So this fixture nests the skills under
    // `<base>/.konductor/skills` with a sibling manifest at
    // `<base>/.konductor/manifest` marking all three skills
    // konductor-installed.
    let base = fresh_temp_dir("no-matching-filter");
    let dir = base.join(".konductor").join("skills");
    std::fs::create_dir_all(&dir).expect("create fixture skills dir");
    let seeded_names = ["keep-me", "keep-also", "keep-too"];
    for name in seeded_names {
        write_skill(
            &dir,
            name,
            &format!("Seeded skill {name}, matched by no filter pattern."),
        );
    }
    let manifest_files: Vec<String> = seeded_names
        .iter()
        .map(|name| {
            format!(
                r#"{{"path":".konductor/skills/{name}/SKILL.md","sha256":null,"provenance":"created"}}"#
            )
        })
        .collect();
    std::fs::create_dir_all(base.join(".konductor")).expect("create .konductor dir");
    std::fs::write(
        base.join(".konductor").join("manifest"),
        format!(
            r#"{{"schema_version":1,"strategy":"kiro-cli","installed_at":"2026-01-01T00:00:00Z","destination":".","status":"complete","files":[{}]}}"#,
            manifest_files.join(",")
        ),
    )
    .expect("write manifest");

    // `base` (not `dir`) must be the guard's removal target, since the
    // manifest lives one level above `dir`.
    let guard = TempDirGuard(base.clone());
    let sink = telemetry_test_sink::TelemetrySink::start();
    let mut child = spawn_server(&dir, Some("nomatch-*"), &sink);

    let mut stdin = child.stdin.take().expect("child stdin not piped");
    let stdout = child.stdout.take().expect("child stdout not piped");
    let mut reader = BufReader::new(stdout);

    complete_handshake(&mut stdin, &mut reader).await;

    let response = call_reload_skills(&mut stdin, &mut reader, 2, serde_json::json!({})).await;
    assert!(
        response.get("result").is_some(),
        "expected reload_skills with a fully-excluding filter to succeed, not error: {response:?}"
    );
    let (indexed, filtered_out) = parse_reload_counts(&response);
    assert_eq!(
        indexed, 0,
        "expected 0 effective (post-filter) indexed skills when the filter matches none: {response:?}"
    );
    assert_eq!(
        filtered_out,
        seeded_names.len() as u64,
        "expected every seeded skill to be counted as filtered out: {response:?}"
    );

    drop(stdin);

    use tokio::io::AsyncReadExt;
    let mut stderr = child.stderr.take().expect("child stderr not piped");
    let mut stderr_buf = String::new();
    let _ = timeout(IO_TIMEOUT, stderr.read_to_string(&mut stderr_buf)).await;
    let status = timeout(IO_TIMEOUT, child.wait())
        .await
        .expect("timed out waiting for skill-lookup-mcp to exit")
        .expect("failed to wait on child process");
    assert!(
        status.success(),
        "skill-lookup-mcp did not exit cleanly: {status:?} (stderr: {stderr_buf})"
    );

    drop(guard);
}
