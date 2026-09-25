// SPDX-License-Identifier: Apache-2.0
//
// get_skill_shakedown.rs — targeted regression coverage for the
// `get_skill` MCP tool after the `rmcp` 0.1.5 -> 2.1.0 bump.
//
// `full_tool_surface.rs` already covers `get_skill`'s single happy path
// (seed one skill, fetch it, assert the body contains a seeded line).
// This file adds the error-path and edge-case coverage that upgrade
// left completely uncovered: exact-vs-substring matching, the three
// distinct failure shapes `get_skill` can return
// (`invalid_params`/"skill not found", `internal_error`/"skill file
// unreadable", `invalid_params`/"skill body too large"), schema
// enforcement (`additionalProperties: false`, required `name`), and
// content-block encoding of an oversized/special-character body --
// exactly the surface most likely to regress silently across a major
// rmcp bump (error-code mapping, JSON content-block construction).
//
// Every helper below (`spawn_server`, `write_message`, `read_json_line`,
// `complete_handshake`, `TempDirGuard`) is copied verbatim from
// `full_tool_surface.rs` so this file is self-contained and consistent
// with the existing suite's conventions, rather than sharing a module
// (integration test binaries in Cargo don't share code across files
// without a separate lib target, which this crate doesn't have).
//
// `MAX_SKILL_BODY_BYTES` here is a local copy of the same value
// `skill-lookup-core::frontmatter::MAX_SKILL_FILE_BYTES` defines
// (confirmed via `mcp/lib/skill-lookup-core/src/frontmatter.rs`: `pub
// const MAX_SKILL_FILE_BYTES: u64 = 1024 * 1024;`, re-exported into
// `skill-lookup-mcp::main` as `MAX_SKILL_BODY_BYTES`). It is not
// `use`d directly from the binary crate because integration tests only
// see the crate's public API surface via its compiled binary, not its
// internal `main.rs` constants -- so this test asserts against the
// same numeric value the source itself computes, kept in sync by the
// comment above rather than by a shared symbol.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::timeout;

const IO_TIMEOUT: Duration = Duration::from_secs(10);

/// Mirrors `skill_lookup_core::frontmatter::MAX_SKILL_FILE_BYTES` /
/// `skill_lookup_mcp::main::MAX_SKILL_BODY_BYTES` (1 MiB). See the
/// module doc comment above for why this is a local copy rather than a
/// shared import.
const MAX_SKILL_BODY_BYTES: u64 = 1024 * 1024;

/// Spawns `skill-lookup-mcp` against `skills_dir`, with `HOME` explicitly
/// unset on the child process so the server's default-root fallback
/// (`~/.konductor/skills/`) can never contribute skills this test didn't
/// seed itself — only the explicit `--skills-dir` counts. Copied
/// verbatim from `full_tool_surface.rs`'s `spawn_server`, minus the
/// telemetry sink wiring: these tests don't exercise telemetry, and a
/// live-but-unused sink would just be extra setup for no coverage gain.
fn spawn_server(skills_dir: &Path) -> Child {
    let bin = env!("CARGO_BIN_EXE_skill-lookup-mcp");
    Command::new(bin)
        .arg("--skills-dir")
        .arg(skills_dir)
        .env_remove("HOME")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .expect("failed to spawn skill-lookup-mcp")
}

/// Writes one JSON-RPC message (request or notification) as a single
/// line to `stdin`, flushing afterward. Bounded by `IO_TIMEOUT` so a
/// blocked write fails fast instead of hanging the test. Copied
/// verbatim from `full_tool_surface.rs`.
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
/// `IO_TIMEOUT`. Copied verbatim from `full_tool_surface.rs`.
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
/// Copied verbatim from `full_tool_surface.rs`.
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
                "clientInfo": {"name": "get-skill-shakedown-test", "version": "0.0.0"}
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

/// Removes its wrapped temp directory on drop, including during panic
/// unwind. Copied verbatim from `full_tool_surface.rs`'s `TempDirGuard`.
struct TempDirGuard(std::path::PathBuf);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Creates a fresh temp dir (disambiguated by `label`, same convention
/// as `full_tool_surface.rs`'s `seed_probe_skill_dir`) with no skills in
/// it yet -- callers seed whatever skill directories they need directly
/// under the returned path via `write_skill_file`.
fn fresh_skills_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "skill-lookup-get-skill-shakedown-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time before UNIX epoch")
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).expect("create fresh skills dir");
    dir
}

/// Writes one skill directory + `SKILL.md` under `skills_root`, with
/// `name` as both the directory name and the frontmatter `name` field,
/// and `body` as the content following the frontmatter block.
fn write_skill_file(skills_root: &Path, name: &str, description: &str, body: &str) {
    let skill_dir = skills_root.join(name);
    std::fs::create_dir_all(&skill_dir).expect("create skill dir");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: {description}\n---\n\n{body}"),
    )
    .expect("write SKILL.md");
}

/// Runs `body(stdin, reader)` against a freshly spawned server over
/// `skills_root` (already seeded by the caller), then tears both down:
/// closes stdin, drains stderr for diagnostics, waits for clean exit,
/// and removes the temp dir. Mirrors `full_tool_surface.rs`'s
/// `with_probe_server`, but takes an already-seeded directory instead
/// of seeding a single fixed probe skill itself, since these tests need
/// varied fixtures (multiple skills, oversized files, special
/// characters) rather than one fixed probe.
async fn with_server_over<F, Fut>(skills_root: std::path::PathBuf, body: F)
where
    F: FnOnce(tokio::process::ChildStdin, BufReader<tokio::process::ChildStdout>) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let dir = TempDirGuard(skills_root);
    let mut child = spawn_server(&dir.0);

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

/// Sends a `tools/call` for `get_skill` with the given raw `arguments`
/// value (so callers can send `{}` or extra unknown keys, not just a
/// well-formed `{"name": ...}`), and returns the raw JSON-RPC response.
async fn call_get_skill<R: tokio::io::AsyncBufRead + Unpin>(
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
            "params": {"name": "get_skill", "arguments": arguments}
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

/// Extracts the JSON-RPC error `code`/`message` pair from a response
/// that is expected to be an error, panicking with the full response if
/// it was a success instead. Used by every error-path test below so the
/// literal `(code, message)` is easy to report.
fn expect_error(response: &serde_json::Value) -> (i64, &str) {
    assert!(
        response.get("result").is_none(),
        "expected an error response but got a result: {response:?}"
    );
    let error = response
        .get("error")
        .unwrap_or_else(|| panic!("expected a JSON-RPC error object: {response:?}"));
    let code = error
        .get("code")
        .and_then(|v| v.as_i64())
        .unwrap_or_else(|| panic!("expected numeric error.code: {error:?}"));
    let message = error
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| panic!("expected string error.message: {error:?}"));
    (code, message)
}

/// The JSON-RPC error code rmcp 2.1.0 uses for `ErrorCode::INVALID_PARAMS`
/// (confirmed in `rmcp-2.1.0/src/model.rs`: `pub const INVALID_PARAMS:
/// Self = Self(-32602);` -- standard JSON-RPC 2.0 "Invalid params").
const INVALID_PARAMS: i64 = -32602;

/// The JSON-RPC error code rmcp 2.1.0 uses for `ErrorCode::INTERNAL_ERROR`
/// (confirmed in `rmcp-2.1.0/src/model.rs`: `pub const INTERNAL_ERROR:
/// Self = Self(-32603);` -- standard JSON-RPC 2.0 "Internal error").
const INTERNAL_ERROR: i64 = -32603;

/// Extracts `get_skill`'s successful `content` string from a
/// `tools/call` response, asserting the envelope shape along the way
/// (a single text content item carrying a JSON object with a `content`
/// field) -- mirrors `full_tool_surface.rs`'s
/// `get_skill_returns_the_seeded_body_content` unwrap chain.
fn expect_success_body(response: &serde_json::Value) -> String {
    let result = response
        .get("result")
        .unwrap_or_else(|| panic!("expected get_skill to succeed: {response:?}"));
    let content_text = result["content"][0]["text"]
        .as_str()
        .unwrap_or_else(|| panic!("expected a text content item: {result:?}"));
    let body: serde_json::Value =
        serde_json::from_str(content_text).expect("get_skill content was not valid JSON");
    body.get("content")
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| panic!("expected string 'content' field: {body:?}"))
        .to_string()
}

#[tokio::test]
async fn get_skill_exact_name_match_case_insensitive() {
    let dir = fresh_skills_dir("case-insensitive");
    write_skill_file(
        &dir,
        "MyTestSkill",
        "A case-insensitivity probe skill",
        "The case-insensitive body line.\n",
    );

    with_server_over(dir, |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        let response =
            call_get_skill(&mut stdin, &mut reader, 2, serde_json::json!({"name": "mytestskill"}))
                .await;
        let content = expect_success_body(&response);
        assert!(
            content.contains("The case-insensitive body line."),
            "expected case-insensitive lookup to return the seeded body, got: {content:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn get_skill_substring_of_real_name_does_not_match() {
    let dir = fresh_skills_dir("substring-no-match");
    write_skill_file(
        &dir,
        "widget-alpha",
        "A skill whose name has 'widget' as a strict prefix",
        "widget-alpha body.\n",
    );

    with_server_over(dir, |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        // "widget" is a substring of the real name "widget-alpha", but
        // get_skill is documented (and implemented, via
        // SkillIndex::get's exact hashmap lookup) as exact-match only --
        // unlike find_skills, which does substring matching on `name`.
        let response =
            call_get_skill(&mut stdin, &mut reader, 2, serde_json::json!({"name": "widget"}))
                .await;
        let (code, message) = expect_error(&response);
        assert_eq!(
            code, INVALID_PARAMS,
            "expected a substring (non-exact) name to be rejected as invalid_params, got code {code}, message {message:?}"
        );
        assert!(
            message.contains("skill not found"),
            "expected 'skill not found' in the error message, got: {message:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn get_skill_nonexistent_name_returns_invalid_params_not_found() {
    let dir = fresh_skills_dir("nonexistent");
    // No skills seeded at all -- any name is guaranteed absent.

    with_server_over(dir, |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        let response = call_get_skill(
            &mut stdin,
            &mut reader,
            2,
            serde_json::json!({"name": "this-skill-definitely-does-not-exist"}),
        )
        .await;
        let (code, message) = expect_error(&response);
        assert_eq!(
            code, INVALID_PARAMS,
            "expected invalid_params (-32602) for an unknown skill name, got code {code}, message {message:?}"
        );
        assert_eq!(
            message, "skill not found: this-skill-definitely-does-not-exist",
            "unexpected error message for an unknown skill name"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn get_skill_missing_required_name_param_is_rejected() {
    let dir = fresh_skills_dir("missing-name");

    with_server_over(dir, |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        let response = call_get_skill(&mut stdin, &mut reader, 2, serde_json::json!({})).await;
        let (code, message) = expect_error(&response);
        // Captured verbatim for the report: `required_str_arg` raises
        // `invalid_params("missing required parameter: name")` when the
        // key is absent entirely.
        eprintln!("get_skill_missing_required_name_param_is_rejected: code={code} message={message:?}");
        assert_eq!(
            code, INVALID_PARAMS,
            "expected invalid_params (-32602) for a missing required 'name', got code {code}, message {message:?}"
        );
        assert!(
            message.contains("missing required parameter") && message.contains("name"),
            "expected a 'missing required parameter: name' style message, got: {message:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn get_skill_unknown_parameter_is_rejected() {
    let dir = fresh_skills_dir("unknown-param");

    with_server_over(dir, |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        let response = call_get_skill(
            &mut stdin,
            &mut reader,
            2,
            serde_json::json!({"name": "x", "bogus": "y"}),
        )
        .await;
        let (code, message) = expect_error(&response);
        eprintln!("get_skill_unknown_parameter_is_rejected: code={code} message={message:?}");
        assert_eq!(
            code, INVALID_PARAMS,
            "expected invalid_params (-32602) for an unknown extra parameter, got code {code}, message {message:?}"
        );
        assert!(
            message.contains("unknown parameter") && message.contains("bogus"),
            "expected the unknown-parameter error to name 'bogus', got: {message:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn get_skill_oversized_body_is_rejected() {
    // IMPORTANT, discovered while writing this test: a SKILL.md that
    // already exceeds MAX_SKILL_BODY_BYTES *at scan time* is rejected
    // by the scanner itself (`frontmatter::parse_frontmatter`'s own
    // stat check, `SkipReason::OversizedSkillFile`) and never enters
    // the index at all. Seeding an oversized fixture up front therefore
    // exercises the *scanner's* skip path, not `get_skill`'s own
    // too-large guard -- `get_skill` would instead report "skill not
    // found" (confirmed by first writing the test that way: it failed
    // with exactly that message). To reach `get_skill`'s own check
    // (its `fs::metadata` stat performed fresh on every call, per the
    // doc comment on `SkillLookupServer::get_skill`), the file must be
    // *within* the limit when the server scans it at startup, then
    // grown past the limit afterward -- the same TOCTOU shape as
    // `get_skill_file_deleted_after_scan_returns_internal_error` below,
    // grown instead of deleted.
    let dir = fresh_skills_dir("oversized-body");
    write_skill_file(
        &dir,
        "grows-too-big",
        "A skill whose SKILL.md starts small and is grown past the limit after scan",
        "small body, well under the limit\n",
    );
    let file_path = dir.join("grows-too-big").join("SKILL.md");

    with_server_over(dir, |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        // Confirm it's indexed and readable before growing it.
        let confirm = call_get_skill(
            &mut stdin,
            &mut reader,
            2,
            serde_json::json!({"name": "grows-too-big"}),
        )
        .await;
        assert!(
            confirm.get("result").is_some(),
            "expected the seeded skill to be readable before growth: {confirm:?}"
        );

        // Grow the file past MAX_SKILL_BODY_BYTES without a rescan --
        // the index still has the pre-growth record, so this exercises
        // get_skill's own fresh `fs::metadata` stat check ("stat size"
        // stage), not the scanner's scan-time skip.
        let padding_bytes = MAX_SKILL_BODY_BYTES as usize + 4096;
        let oversized_body = "A".repeat(padding_bytes);
        std::fs::write(
            &file_path,
            format!(
                "---\nname: grows-too-big\ndescription: grown past the limit\n---\n\n{oversized_body}"
            ),
        )
        .expect("grow the skill file past the size limit");
        let actual_size = std::fs::metadata(&file_path)
            .expect("stat the grown fixture file")
            .len();
        assert!(
            actual_size > MAX_SKILL_BODY_BYTES,
            "fixture setup bug: grows-too-big/SKILL.md is {actual_size} bytes after growth, \
             not over the {MAX_SKILL_BODY_BYTES}-byte limit"
        );

        let response = call_get_skill(
            &mut stdin,
            &mut reader,
            3,
            serde_json::json!({"name": "grows-too-big"}),
        )
        .await;
        let (code, message) = expect_error(&response);
        eprintln!("get_skill_oversized_body_is_rejected: code={code} message={message:?}");
        assert_eq!(
            code, INVALID_PARAMS,
            "expected invalid_params (-32602) for an oversized body, got code {code}, message {message:?}"
        );
        assert!(
            message.contains("too large"),
            "expected a 'too large' error message, got: {message:?}"
        );
        assert!(
            message.contains("grows-too-big"),
            "expected the error message to name the skill, got: {message:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn get_skill_body_with_special_characters_round_trips_correctly() {
    let dir = fresh_skills_dir("special-chars");
    // Stresses JSON string encoding specifically: a non-ASCII/emoji
    // character (multi-byte UTF-8, outside the BMP for the emoji),
    // an embedded literal newline (not just the trailing one from the
    // file format), a literal backslash, and a literal double-quote --
    // each of these requires correct JSON escaping both when this
    // server serializes GetSkillResponse into a text ContentBlock and
    // when it's later parsed back out by this test.
    let special_body =
        "Special chars: caf\u{e9} \u{1f680} rocket\nSecond line with \\backslash\\ and \"quotes\".\n";
    write_skill_file(
        &dir,
        "special-chars-skill",
        "A skill body stressing JSON encoding",
        special_body,
    );

    with_server_over(dir, |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        let response = call_get_skill(
            &mut stdin,
            &mut reader,
            2,
            serde_json::json!({"name": "special-chars-skill"}),
        )
        .await;
        let content = expect_success_body(&response);
        assert!(
            content.ends_with(special_body),
            "expected the special-character body to round-trip byte-for-byte \
             (modulo the frontmatter prefix); got tail: {:?}, expected suffix: {:?}",
            &content[content.len().saturating_sub(special_body.len().min(content.len()))..],
            special_body
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn get_skill_empty_name_is_rejected_or_not_found() {
    let dir = fresh_skills_dir("empty-name");
    write_skill_file(
        &dir,
        "some-real-skill",
        "A real skill, present so an empty-name lookup can't accidentally match it",
        "body\n",
    );

    with_server_over(dir, |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        let response =
            call_get_skill(&mut stdin, &mut reader, 2, serde_json::json!({"name": ""})).await;

        // Source-level expectation, confirmed by reading handlers.rs:
        // `get_skill` calls `required_str_arg` (not
        // `non_empty_optional_str_arg`, which is what `find_skills` uses
        // for its optional filters and which explicitly rejects `""`
        // with "parameter 'name' must not be empty"). `required_str_arg`
        // only checks *presence*, not emptiness, so an empty string
        // reaches `self.index.get("")` -- an ordinary hashmap lookup for
        // the key `""`, which is simply absent, falling through to the
        // *same* "skill not found: " path as any other unknown name
        // (message ends up being "skill not found: " with nothing after
        // the colon, since `name` itself is empty). This is verified,
        // not assumed, by the assertions below.
        let (code, message) = expect_error(&response);
        eprintln!("get_skill_empty_name_is_rejected_or_not_found: code={code} message={message:?}");
        assert_eq!(
            code, INVALID_PARAMS,
            "expected invalid_params (-32602) for an empty 'name', got code {code}, message {message:?}"
        );
        assert_eq!(
            message, "skill not found: ",
            "expected get_skill to treat an empty name as an ordinary miss on the \
             'skill not found' path (get_skill has no non_empty_optional_str_arg-style \
             guard on 'name', unlike find_skills's optional filters), got: {message:?}"
        );

        drop(stdin);
    })
    .await;
}

/// Regression coverage for `get_skill`'s `internal_error` /
/// "skill file unreadable" path: the index has a record for the name,
/// but the underlying file is gone by the time `get_skill` tries to
/// read it (deleted between server startup's scan and this call) --
/// exactly the TOCTOU case the doc comment on `get_skill` describes.
/// Distinguishes this from the "skill not found" (`invalid_params`)
/// case above: the index still has an entry, so the failure must come
/// from the `fs::metadata`/`fs::read_to_string` calls after the lookup,
/// not from `SkillIndex::get` itself.
#[tokio::test]
async fn get_skill_file_deleted_after_scan_returns_internal_error() {
    let dir = fresh_skills_dir("deleted-after-scan");
    write_skill_file(
        &dir,
        "soon-to-be-deleted",
        "A skill whose file is removed after the server has already scanned it",
        "will be deleted\n",
    );
    let file_path = dir.join("soon-to-be-deleted").join("SKILL.md");

    with_server_over(dir, |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        // Confirm the index actually has this record before yanking the
        // file out from under it, so a failure here is unambiguously a
        // read-time failure, not an indexing failure.
        let confirm = call_get_skill(
            &mut stdin,
            &mut reader,
            2,
            serde_json::json!({"name": "soon-to-be-deleted"}),
        )
        .await;
        assert!(
            confirm.get("result").is_some(),
            "expected the seeded skill to be readable before deletion: {confirm:?}"
        );

        std::fs::remove_file(&file_path).expect("delete the skill file out from under the index");

        let response = call_get_skill(
            &mut stdin,
            &mut reader,
            3,
            serde_json::json!({"name": "soon-to-be-deleted"}),
        )
        .await;
        let (code, message) = expect_error(&response);
        eprintln!(
            "get_skill_file_deleted_after_scan_returns_internal_error: code={code} message={message:?}"
        );
        assert_eq!(
            code, INTERNAL_ERROR,
            "expected internal_error (-32603) for a file removed after scan, got code {code}, message {message:?}"
        );
        assert!(
            message.contains("skill file unreadable") && message.contains("soon-to-be-deleted"),
            "expected a 'skill file unreadable: soon-to-be-deleted: ...' style message, got: {message:?}"
        );

        drop(stdin);
    })
    .await;
}
