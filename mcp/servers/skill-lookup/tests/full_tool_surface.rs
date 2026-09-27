// SPDX-License-Identifier: Apache-2.0
//
// full_tool_surface.rs — end-to-end MCP JSON-RPC coverage for all three
// skill-lookup-mcp tools (`find_skills`, `get_skill`, `reload_skills`)
// plus `tools/list`, against a real seeded `--skills-dir`.
//
// `initialize_handshake.rs` already proves the handshake itself: a
// clean `initialize` response, the second-`initialize`-is-rejected
// regression, and that `reload_skills` mirrors its scan diagnostic to
// stderr the same way startup does. What it does not cover is the rest
// of the tool surface's actual response *content* against a real,
// non-empty skills directory: `find_skills`' returned record fields
// (name/description/provenance/size_bytes), `get_skill`'s returned body
// content, and `tools/list`'s advertised tool set. This file adds that
// coverage using the same spawn/write/read-line JSON-RPC framing
// pattern as `initialize_handshake.rs`, reading responses by JSON-RPC
// `id` rather than assuming response ordering.
//
// Determinism: every spawned child is given an explicit, freshly
// created temp `--skills-dir` and `HOME` is explicitly unset on the
// child (not the test process — mutating the test process's own env
// would race with Rust's parallel test threads) so a developer's real
// `~/.konductor/skills` can never leak into these counts. Every stdio
// read is wrapped in a bounded `timeout` so a hang fails fast instead of
// blocking the suite.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::timeout;

const IO_TIMEOUT: Duration = Duration::from_secs(10);

/// Recognisable body line seeded into the probe skill's `SKILL.md`,
/// asserted on verbatim by the `get_skill` test below.
const SEEDED_BODY_LINE: &str = "This is the seeded body line for full_tool_surface.rs.";

/// Spawns `skill-lookup-mcp` against `skills_dir`, with `HOME` explicitly
/// unset on the child process so the server's default-root fallback
/// (`~/.konductor/skills/`) can never contribute skills this test didn't
/// seed itself — only the explicit `--skills-dir` counts. `sink`'s own
/// env vars redirect this server's telemetry to the loopback fixture --
/// every tool call increments its counters, flushed on shutdown.
fn spawn_server(skills_dir: &Path, sink: &telemetry_test_sink::TelemetrySink) -> Child {
    let bin = env!("CARGO_BIN_EXE_skill-lookup-mcp");
    let mut command = Command::new(bin);
    command
        .arg("--skills-dir")
        .arg(skills_dir)
        .env_remove("HOME");
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
                "clientInfo": {"name": "full-tool-surface-test", "version": "0.0.0"}
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

/// Creates a fresh temp directory containing exactly one skill,
/// `full-tool-surface-probe`, with valid frontmatter and the
/// recognisable `SEEDED_BODY_LINE`. `label` distinguishes this call
/// from the other `#[tokio::test]`s in this file — matching the
/// pattern already used by `cli.rs`'s and `handlers.rs`'s own
/// `temp_dir(label)` test helpers and by `initialize_handshake.rs`'s
/// per-test literal prefixes — since without it, tests starting in the
/// same clock tick can land on a byte-identical directory name (pid +
/// nanos alone is not always enough to disambiguate at this
/// granularity) and race on `TempDirGuard::drop` deleting the directory
/// a sibling test is still serving out of. Returns the temp dir path;
/// callers are expected to wrap it in `TempDirGuard` (as
/// `with_probe_server` does) so it is removed on drop, including
/// during a panicking test.
fn seed_probe_skill_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "skill-lookup-full-tool-surface-test-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time before UNIX epoch")
            .as_nanos()
    ));
    let skill_dir = dir.join("full-tool-surface-probe");
    std::fs::create_dir_all(&skill_dir).expect("create probe skill dir");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        format!(
            "---\nname: full-tool-surface-probe\ndescription: Probe skill for the full_tool_surface E2E test\n---\n\n{SEEDED_BODY_LINE}\n"
        ),
    )
    .expect("write probe SKILL.md");
    dir
}

/// Runs `body(stdin, reader, dir)` against a freshly spawned server over
/// a freshly seeded probe skill dir, then tears both down: closes stdin,
/// drains stderr for diagnostics, waits for clean exit, and removes the
/// temp dir. Centralizing spawn/seed/teardown here keeps each test below
/// focused on the one tool call it's asserting on.
///
/// `label` is forwarded to `seed_probe_skill_dir` to keep this test's
/// temp directory distinct from its sibling `#[tokio::test]`s in this
/// file; see that function's doc comment for why.
///
/// The temp dir is wrapped in `TempDirGuard` so a panicking `body` (a
/// failing assertion) still removes it during unwind, instead of
/// leaking it the way a plain post-`body` `remove_dir_all` call would.
async fn with_probe_server<F, Fut>(label: &str, body: F)
where
    F: FnOnce(tokio::process::ChildStdin, BufReader<tokio::process::ChildStdout>) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let dir = TempDirGuard(seed_probe_skill_dir(label));
    let sink = telemetry_test_sink::TelemetrySink::start();
    let mut child = spawn_server(&dir.0, &sink);

    let stdin = child.stdin.take().expect("child stdin not piped");
    let stdout = child.stdout.take().expect("child stdout not piped");
    let reader = BufReader::new(stdout);

    body(stdin, reader).await;

    // `body` already dropped its `stdin` handle (moved in by value) by
    // the time we get here, giving the server EOF; wait for clean exit
    // before cleaning up, draining stderr first so a failure includes
    // what the server logged.
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

    // `dir`'s `Drop` impl removes the temp dir; explicit drop here just
    // documents that the guard's job is done on the success path too.
    drop(dir);
}

/// Removes its wrapped temp directory on drop, including during panic
/// unwind — so a failing test's assertion inside `body` still cleans up
/// instead of leaking the directory (the child process itself is
/// already handled via `kill_on_drop(true)` on spawn).
struct TempDirGuard(std::path::PathBuf);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[tokio::test]
async fn tools_list_advertises_exactly_the_three_tools() {
    with_probe_server("tools-list", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        write_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list"
            }),
        )
        .await;
        let response = read_json_line(&mut reader).await;
        assert_eq!(
            response.get("id").and_then(|v| v.as_i64()),
            Some(2),
            "tools/list response did not echo request id 2: {response:?}"
        );

        let tools = response
            .pointer("/result/tools")
            .and_then(|v| v.as_array())
            .unwrap_or_else(|| panic!("expected result.tools array: {response:?}"));
        let names: Vec<&str> = tools
            .iter()
            .filter_map(|t| t.get("name").and_then(|n| n.as_str()))
            .collect();

        for expected in ["find_skills", "get_skill", "reload_skills"] {
            assert!(
                names.contains(&expected),
                "expected tools/list to advertise '{expected}', got {names:?}"
            );
        }
        assert_eq!(
            names.len(),
            3,
            "expected exactly three advertised tools, got {names:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn find_skills_with_no_args_returns_the_seeded_skill() {
    with_probe_server("find-skills", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        write_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "find_skills", "arguments": {}}
            }),
        )
        .await;
        let response = read_json_line(&mut reader).await;
        assert_eq!(
            response.get("id").and_then(|v| v.as_i64()),
            Some(2),
            "find_skills response did not echo request id 2: {response:?}"
        );
        let result = response
            .get("result")
            .unwrap_or_else(|| panic!("expected find_skills to succeed: {response:?}"));

        let content_text = result["content"][0]["text"]
            .as_str()
            .expect("expected a text content item in the find_skills result");
        let records: Vec<serde_json::Value> =
            serde_json::from_str(content_text).expect("find_skills content was not a JSON array");
        assert_eq!(
            records.len(),
            1,
            "expected exactly one seeded skill, got: {records:?}"
        );

        let record = &records[0];
        assert_eq!(
            record.get("name").and_then(|v| v.as_str()),
            Some("full-tool-surface-probe"),
            "unexpected 'name' in find_skills record: {record:?}"
        );
        assert_eq!(
            record.get("description").and_then(|v| v.as_str()),
            Some("Probe skill for the full_tool_surface E2E test"),
            "unexpected 'description' in find_skills record: {record:?}"
        );
        assert_eq!(
            record.get("provenance").and_then(|v| v.as_str()),
            Some("managed"),
            "expected 'managed' provenance for the first --skills-dir: {record:?}"
        );
        let size_bytes = record
            .get("size_bytes")
            .and_then(|v| v.as_u64())
            .unwrap_or_else(|| panic!("expected numeric 'size_bytes' in record: {record:?}"));
        assert!(
            size_bytes > 0 && size_bytes < 1024,
            "expected a plausible size_bytes for this small seeded SKILL.md, got {size_bytes}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn get_skill_returns_the_seeded_body_content() {
    with_probe_server("get-skill", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        write_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "get_skill",
                    "arguments": {"name": "full-tool-surface-probe"}
                }
            }),
        )
        .await;
        let response = read_json_line(&mut reader).await;
        assert_eq!(
            response.get("id").and_then(|v| v.as_i64()),
            Some(2),
            "get_skill response did not echo request id 2: {response:?}"
        );
        let result = response
            .get("result")
            .unwrap_or_else(|| panic!("expected get_skill to succeed: {response:?}"));

        let content_text = result["content"][0]["text"]
            .as_str()
            .expect("expected a text content item in the get_skill result");
        let body: serde_json::Value =
            serde_json::from_str(content_text).expect("get_skill content was not valid JSON");

        assert_eq!(
            body.get("name").and_then(|v| v.as_str()),
            Some("full-tool-surface-probe"),
            "unexpected 'name' in get_skill response: {body:?}"
        );
        let content = body
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("expected string 'content' in get_skill response: {body:?}"));
        assert!(
            content.contains(SEEDED_BODY_LINE),
            "expected get_skill's content to contain the seeded body line, got: {content:?}"
        );

        drop(stdin);
    })
    .await;
}

/// Recognisable body line seeded into the probe SOP, asserted on
/// verbatim by the `prompts/get` test below.
const SEEDED_SOP_BODY: &str = "This is the seeded SOP body for full_tool_surface.rs.\n";

/// Spawns `skill-lookup-mcp` against `sop_dir` via `--agent-sop-paths`
/// (no `--skills-dir`), with `HOME` unset so the skill default-root
/// fallback contributes nothing. Used by the prompt E2E tests.
fn spawn_server_with_sops(sop_dir: &Path) -> Child {
    let bin = env!("CARGO_BIN_EXE_skill-lookup-mcp");
    Command::new(bin)
        .arg("--agent-sop-paths")
        .arg(sop_dir)
        .env_remove("HOME")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .expect("failed to spawn skill-lookup-mcp")
}

/// Creates a fresh temp directory containing exactly one SOP,
/// `full-tool-surface-probe.sop.md`, carrying `SEEDED_SOP_BODY`.
/// `label` disambiguates concurrent tests, same as `seed_probe_skill_dir`.
fn seed_probe_sop_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "skill-lookup-full-tool-surface-sop-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time before UNIX epoch")
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).expect("create probe SOP dir");
    std::fs::write(dir.join("full-tool-surface-probe.sop.md"), SEEDED_SOP_BODY)
        .expect("write probe SOP");
    dir
}

/// The `with_probe_server` counterpart for prompt tests: spawns a server
/// over a freshly seeded SOP dir, runs `body`, then tears both down.
async fn with_probe_sop_server<F, Fut>(label: &str, body: F)
where
    F: FnOnce(tokio::process::ChildStdin, BufReader<tokio::process::ChildStdout>) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let dir = TempDirGuard(seed_probe_sop_dir(label));
    let mut child = spawn_server_with_sops(&dir.0);

    let stdin = child.stdin.take().expect("child stdin not piped");
    let stdout = child.stdout.take().expect("child stdout not piped");
    let reader = BufReader::new(stdout);

    body(stdin, reader).await;

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

    drop(dir);
}

#[tokio::test]
async fn prompts_list_advertises_the_seeded_sop() {
    with_probe_sop_server("prompts-list", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        write_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "prompts/list"
            }),
        )
        .await;
        let response = read_json_line(&mut reader).await;
        assert_eq!(
            response.get("id").and_then(|v| v.as_i64()),
            Some(2),
            "prompts/list response did not echo request id 2: {response:?}"
        );

        let prompts = response
            .pointer("/result/prompts")
            .and_then(|v| v.as_array())
            .unwrap_or_else(|| panic!("expected result.prompts array: {response:?}"));
        let names: Vec<&str> = prompts
            .iter()
            .filter_map(|p| p.get("name").and_then(|n| n.as_str()))
            .collect();
        assert_eq!(
            names,
            vec!["full-tool-surface-probe"],
            "expected exactly the one seeded SOP, got {names:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn prompts_get_returns_the_seeded_sop_body() {
    with_probe_sop_server("prompts-get", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        write_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "prompts/get",
                "params": {"name": "full-tool-surface-probe"}
            }),
        )
        .await;
        let response = read_json_line(&mut reader).await;
        assert_eq!(
            response.get("id").and_then(|v| v.as_i64()),
            Some(2),
            "prompts/get response did not echo request id 2: {response:?}"
        );
        let result = response
            .get("result")
            .unwrap_or_else(|| panic!("expected prompts/get to succeed: {response:?}"));

        // One user message carrying the raw SOP body verbatim.
        let text = result
            .pointer("/messages/0/content/text")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("expected messages[0].content.text: {result:?}"));
        assert_eq!(text, SEEDED_SOP_BODY, "prompt body was not the seeded text");
        assert_eq!(
            result.pointer("/messages/0/role").and_then(|v| v.as_str()),
            Some("user"),
            "expected the prompt message role to be 'user': {result:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn prompts_get_unknown_name_returns_an_error() {
    with_probe_sop_server("prompts-get-unknown", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        write_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "prompts/get",
                "params": {"name": "does-not-exist"}
            }),
        )
        .await;
        let response = read_json_line(&mut reader).await;
        assert_eq!(
            response.get("id").and_then(|v| v.as_i64()),
            Some(2),
            "prompts/get response did not echo request id 2: {response:?}"
        );
        assert!(
            response.get("error").is_some(),
            "expected an unknown prompt name to be rejected with a JSON-RPC error: {response:?}"
        );
        assert!(
            response.get("result").is_none(),
            "an unknown prompt must not return a result: {response:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn tools_list_with_a_real_cursor_still_returns_every_tool_and_no_next_cursor() {
    // `list_tools` takes `_request: Option<PaginatedRequestParams>` and
    // unconditionally answers via `ListToolsResult::with_all_items(...)`
    // — the parameter is never read. A non-empty `cursor` is accepted by
    // the schema but has zero effect: the full three-tool set comes back
    // regardless, and `result.nextCursor` is absent (`with_all_items`
    // hardcodes `next_cursor: None`, which `Option::is_none` then skips
    // serializing). Cursor-based pagination is wire-accepted but not
    // implemented.
    with_probe_server("tools-list-cursor", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        write_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {"cursor": "some-arbitrary-cursor-value"}
            }),
        )
        .await;
        let response = read_json_line(&mut reader).await;
        assert_eq!(
            response.get("id").and_then(|v| v.as_i64()),
            Some(2),
            "tools/list response did not echo request id 2: {response:?}"
        );

        let result = response
            .get("result")
            .unwrap_or_else(|| panic!("expected tools/list with a cursor to still succeed (the cursor is not validated), got: {response:?}"));

        let tools = result
            .get("tools")
            .and_then(|v| v.as_array())
            .unwrap_or_else(|| panic!("expected result.tools array: {response:?}"));
        let names: Vec<&str> = tools
            .iter()
            .filter_map(|t| t.get("name").and_then(|n| n.as_str()))
            .collect();
        for expected in ["find_skills", "get_skill", "reload_skills"] {
            assert!(
                names.contains(&expected),
                "a non-None cursor must not suppress any advertised tool, expected '{expected}', got {names:?}"
            );
        }
        assert_eq!(
            names.len(),
            3,
            "expected all three tools regardless of the supplied cursor, got {names:?}"
        );

        // Pagination is not implemented, so no continuation cursor is
        // ever produced.
        assert!(
            result.get("nextCursor").is_none(),
            "expected no nextCursor since list_tools always returns every item \
             regardless of the supplied cursor (pagination is not implemented): {result:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn list_tools_and_list_prompts_omit_the_meta_field_entirely() {
    // `rmcp` 2.1.0's `with_all_items` constructor (used by both
    // `list_tools` and `list_prompts` in `handlers.rs`) hardcodes
    // `meta: None`, and the field's own
    // `#[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]`
    // attribute means a `None` meta is not serialized as `"_meta": null`
    // — the `_meta` key is omitted from the JSON response entirely.
    with_probe_sop_server("list-meta-absent", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        write_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "prompts/list"
            }),
        )
        .await;
        let response = read_json_line(&mut reader).await;
        let result = response
            .get("result")
            .unwrap_or_else(|| panic!("expected prompts/list to succeed: {response:?}"));
        assert!(
            result.get("_meta").is_none(),
            "expected no '_meta' key on ListPromptsResult (with_all_items sets meta: None, \
             which skip_serializing_if omits from the wire), got: {result:?}"
        );
        assert!(
            result.get("nextCursor").is_none(),
            "expected no 'nextCursor' key on ListPromptsResult for the same reason: {result:?}"
        );

        drop(stdin);
    })
    .await;

    with_probe_server("list-meta-absent-tools", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        write_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list"
            }),
        )
        .await;
        let response = read_json_line(&mut reader).await;
        let result = response
            .get("result")
            .unwrap_or_else(|| panic!("expected tools/list to succeed: {response:?}"));
        assert!(
            result.get("_meta").is_none(),
            "expected no '_meta' key on ListToolsResult (with_all_items sets meta: None, \
             which skip_serializing_if omits from the wire), got: {result:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn reload_skills_succeeds_and_reports_the_expected_indexed_count() {
    with_probe_server("reload-skills", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        write_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "reload_skills", "arguments": {}}
            }),
        )
        .await;
        let response = read_json_line(&mut reader).await;
        assert_eq!(
            response.get("id").and_then(|v| v.as_i64()),
            Some(2),
            "reload_skills response did not echo request id 2: {response:?}"
        );
        let result = response
            .get("result")
            .unwrap_or_else(|| panic!("expected reload_skills to succeed: {response:?}"));

        let content_text = result["content"][0]["text"]
            .as_str()
            .expect("expected a text content item in the reload_skills result");
        let body: serde_json::Value =
            serde_json::from_str(content_text).expect("reload_skills content was not valid JSON");

        assert_eq!(
            body.get("indexed").and_then(|v| v.as_u64()),
            Some(1),
            "expected reload_skills to report exactly 1 indexed skill: {body:?}"
        );
        assert_eq!(
            body.get("filtered_out").and_then(|v| v.as_u64()),
            Some(0),
            "expected no filter active, so filtered_out must be 0: {body:?}"
        );

        drop(stdin);
    })
    .await;
}
