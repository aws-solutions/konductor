// SPDX-License-Identifier: Apache-2.0
//
// initialize_handshake.rs — proves the skill-lookup-mcp binary completes an
// MCP `initialize` handshake over stdio and exits cleanly afterward.
//
// This spawns the actual compiled binary (via CARGO_BIN_EXE_skill-lookup-mcp,
// which `cargo test` sets automatically) as a child process, writes a raw
// JSON-RPC `initialize` request to its stdin, and asserts a well-formed
// JSON-RPC response comes back on stdout before closing stdin and waiting
// for clean exit. No `--skills-dir` flags are passed, matching the CR A
// scope of "starts, answers initialize, exits cleanly" with no scanning.

use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

#[tokio::test]
async fn initialize_handshake_completes_over_stdio() {
    let bin = env!("CARGO_BIN_EXE_skill-lookup-mcp");

    let mut child = Command::new(bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn skill-lookup-mcp");

    let mut stdin = child.stdin.take().expect("child stdin not piped");
    let stdout = child.stdout.take().expect("child stdout not piped");
    let mut reader = BufReader::new(stdout);

    // Minimal MCP `initialize` request. Real clients send more fields
    // (clientInfo, capabilities); rmcp's InitializeRequestParam only
    // requires protocolVersion + capabilities + clientInfo per the spec,
    // but this test only needs a request the server will accept and
    // reply to -- it is not exercising protocol negotiation edge cases.
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "initialize-handshake-test",
                "version": "0.0.0"
            }
        }
    });
    let mut line = serde_json::to_string(&request).expect("serialize request");
    line.push('\n');

    timeout(Duration::from_secs(10), stdin.write_all(line.as_bytes()))
        .await
        .expect("timed out writing initialize request")
        .expect("failed to write initialize request to child stdin");
    timeout(Duration::from_secs(10), stdin.flush())
        .await
        .expect("timed out flushing child stdin")
        .expect("failed to flush child stdin");

    let mut response_line = String::new();
    timeout(
        Duration::from_secs(10),
        reader.read_line(&mut response_line),
    )
    .await
    .expect("timed out waiting for initialize response")
    .expect("failed to read initialize response from child stdout");

    assert!(
        !response_line.trim().is_empty(),
        "expected a non-empty initialize response line"
    );

    let response: serde_json::Value =
        serde_json::from_str(response_line.trim()).expect("initialize response was not valid JSON");

    assert_eq!(
        response.get("jsonrpc").and_then(|v| v.as_str()),
        Some("2.0"),
        "response missing/incorrect jsonrpc field: {response:?}"
    );
    assert_eq!(
        response.get("id").and_then(|v| v.as_i64()),
        Some(1),
        "response id did not echo the request id: {response:?}"
    );
    assert!(
        response.get("result").is_some(),
        "expected an initialize result (no error) in response: {response:?}"
    );
    let server_name = response
        .pointer("/result/serverInfo/name")
        .and_then(|v| v.as_str());
    assert_eq!(
        server_name,
        Some("skill-lookup-mcp"),
        "expected serverInfo.name == skill-lookup-mcp, got response: {response:?}"
    );

    // The server enables both the tools and prompts capabilities (the
    // latter serves agent SOPs via prompts/list and prompts/get), so the
    // initialize result must advertise both. Asserting on `prompts`
    // specifically is what proves `.enable_prompts()` reaches the wire.
    assert!(
        response.pointer("/result/capabilities/tools").is_some(),
        "expected the tools capability to be advertised: {response:?}"
    );
    assert!(
        response.pointer("/result/capabilities/prompts").is_some(),
        "expected the prompts capability to be advertised: {response:?}"
    );

    // The MCP handshake isn't done after the initialize response alone --
    // per spec, the client must follow up with a `notifications/initialized`
    // notification before the session is considered ready. rmcp's
    // `serve()` enforces this: it waits for that notification and returns
    // an error (surfaced by our binary as a non-zero exit) if the peer
    // disconnects without ever sending it. Real MCP clients always send
    // this, so the test must too in order to exercise the same "clean
    // exit" path a real client would trigger.
    let initialized_notification = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });
    let mut notif_line = serde_json::to_string(&initialized_notification)
        .expect("serialize initialized notification");
    notif_line.push('\n');
    timeout(
        Duration::from_secs(10),
        stdin.write_all(notif_line.as_bytes()),
    )
    .await
    .expect("timed out writing initialized notification")
    .expect("failed to write initialized notification to child stdin");
    timeout(Duration::from_secs(10), stdin.flush())
        .await
        .expect("timed out flushing child stdin (initialized notification)")
        .expect("failed to flush child stdin (initialized notification)");

    // Close stdin (EOF) so the server's read loop ends and it can exit
    // cleanly, then confirm it actually does exit -- this is the "exits
    // cleanly" half of the acceptance criterion, not just "answers
    // initialize".
    drop(stdin);
    let status = timeout(Duration::from_secs(10), child.wait())
        .await
        .expect("timed out waiting for skill-lookup-mcp to exit after stdin EOF")
        .expect("failed to wait on child process");

    assert!(
        status.success(),
        "skill-lookup-mcp did not exit cleanly after stdin EOF: {status:?}"
    );
}

// Regression test for the CRITICAL adversarial-review finding: a second
// `initialize` request on the same session must be rejected with a
// protocol error, not silently re-answered with a fresh `InitializeResult`.
// This sends `initialize`, then `notifications/initialized` (completing the
// handshake), then a second `initialize` -- matching the adversarial
// review's own reproduction sequence -- and asserts the second response is
// a JSON-RPC error, not a second success result.
#[tokio::test]
async fn second_initialize_request_is_rejected() {
    let bin = env!("CARGO_BIN_EXE_skill-lookup-mcp");

    let mut child = Command::new(bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn skill-lookup-mcp");

    let mut stdin = child.stdin.take().expect("child stdin not piped");
    let stdout = child.stdout.take().expect("child stdout not piped");
    let mut reader = BufReader::new(stdout);

    let make_initialize_request = |id: u64| {
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "double-initialize-test",
                    "version": "0.0.0"
                }
            }
        })
    };

    // First `initialize` -- must succeed, matching the happy-path test above.
    let mut first_line = serde_json::to_string(&make_initialize_request(1))
        .expect("serialize first initialize request");
    first_line.push('\n');
    timeout(
        Duration::from_secs(10),
        stdin.write_all(first_line.as_bytes()),
    )
    .await
    .expect("timed out writing first initialize request")
    .expect("failed to write first initialize request to child stdin");
    timeout(Duration::from_secs(10), stdin.flush())
        .await
        .expect("timed out flushing child stdin (first initialize)")
        .expect("failed to flush child stdin (first initialize)");

    let mut first_response_line = String::new();
    timeout(
        Duration::from_secs(10),
        reader.read_line(&mut first_response_line),
    )
    .await
    .expect("timed out waiting for first initialize response")
    .expect("failed to read first initialize response from child stdout");
    let first_response: serde_json::Value = serde_json::from_str(first_response_line.trim())
        .expect("first initialize response was not valid JSON");
    assert!(
        first_response.get("result").is_some(),
        "expected the first initialize to succeed: {first_response:?}"
    );

    // Per the MCP spec, the client must send `notifications/initialized`
    // after a successful `initialize` before the session is considered
    // ready. The adversarial-review reproduction that found this bug sent
    // the second `initialize` *after* this notification (a
    // reconnect-without-restart scenario), not before -- sending it
    // before would just hit rmcp's own handshake-sequencing wait inside
    // `serve()`, which is a different code path than the one this test is
    // targeting.
    let initialized_notification = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });
    let mut notif_line = serde_json::to_string(&initialized_notification)
        .expect("serialize initialized notification");
    notif_line.push('\n');
    timeout(
        Duration::from_secs(10),
        stdin.write_all(notif_line.as_bytes()),
    )
    .await
    .expect("timed out writing initialized notification")
    .expect("failed to write initialized notification to child stdin");
    timeout(Duration::from_secs(10), stdin.flush())
        .await
        .expect("timed out flushing child stdin (initialized notification)")
        .expect("failed to flush child stdin (initialized notification)");

    // Second `initialize`, same session, no restart -- must be rejected.
    let mut second_line = serde_json::to_string(&make_initialize_request(2))
        .expect("serialize second initialize request");
    second_line.push('\n');
    timeout(
        Duration::from_secs(10),
        stdin.write_all(second_line.as_bytes()),
    )
    .await
    .expect("timed out writing second initialize request")
    .expect("failed to write second initialize request to child stdin");
    timeout(Duration::from_secs(10), stdin.flush())
        .await
        .expect("timed out flushing child stdin (second initialize)")
        .expect("failed to flush child stdin (second initialize)");

    let mut second_response_line = String::new();
    let read_result = timeout(
        Duration::from_secs(10),
        reader.read_line(&mut second_response_line),
    )
    .await
    .expect("timed out waiting for second initialize response");
    if let Err(e) = read_result {
        panic!("failed to read second initialize response from child stdout: {e}");
    }
    if second_response_line.trim().is_empty() {
        use tokio::io::AsyncReadExt;
        let mut stderr = child.stderr.take().expect("child stderr not piped");
        let mut stderr_buf = String::new();
        let _ = timeout(
            Duration::from_secs(2),
            stderr.read_to_string(&mut stderr_buf),
        )
        .await;
        panic!(
            "second initialize response line was empty (server likely closed the \
             connection instead of returning a JSON-RPC error); child stderr: {stderr_buf}"
        );
    }
    let second_response: serde_json::Value = serde_json::from_str(second_response_line.trim())
        .expect("second initialize response was not valid JSON");

    // Drain stderr for diagnostics before asserting, so failure output
    // includes what the server logged for this exchange.
    use tokio::io::AsyncReadExt;
    drop(stdin);
    let mut stderr = child.stderr.take().expect("child stderr not piped");
    let mut stderr_buf = String::new();
    let _ = timeout(
        Duration::from_secs(2),
        stderr.read_to_string(&mut stderr_buf),
    )
    .await;
    let _ = timeout(Duration::from_secs(10), child.wait()).await;

    assert_eq!(
        second_response.get("id").and_then(|v| v.as_i64()),
        Some(2),
        "second response did not echo the second request's id: {second_response:?} (stderr: {stderr_buf})"
    );
    assert!(
        second_response.get("error").is_some(),
        "expected the second initialize to be rejected with a JSON-RPC error, got: {second_response:?} (stderr: {stderr_buf})"
    );
    assert!(
        second_response.get("result").is_none(),
        "second initialize must not return a fresh result: {second_response:?} (stderr: {stderr_buf})"
    );
}

// Regression test for the IMPORTANT review finding: `reload_skills`
// returned its `ScanDiagnostic` only in the MCP response, while startup
// always calls `ScanDiagnostic::emit_to_stderr()` -- so reloading
// regressed operator visibility relative to boot. This spawns the real
// binary against a real `--skills-dir`, completes the handshake, calls
// `reload_skills`, and asserts the child's stderr carries the same
// "scan complete" summary line startup itself would emit.
//
// Also covers f-e9ebf562: with `--skill-name-filter` active, the stderr
// summary and the JSON response's `indexed` field must report the same
// effective (post-filter) count, and the stderr line must spell out the
// total/filtered/effective breakdown so an operator doesn't have to
// guess why the two channels differ. `run_reload_and_capture` is shared
// by the unfiltered case below and the filter-active case in
// `reload_skills_with_filter_reports_total_filtered_and_effective_counts_in_stderr`.
async fn run_reload_and_capture(dir: &std::path::Path, filter: Option<&str>) -> (u64, String) {
    let bin = env!("CARGO_BIN_EXE_skill-lookup-mcp");

    let mut cmd = Command::new(bin);
    cmd.arg("--skills-dir").arg(dir);
    if let Some(f) = filter {
        cmd.arg("--skill-name-filter").arg(f);
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn skill-lookup-mcp");

    let mut stdin = child.stdin.take().expect("child stdin not piped");
    let stdout = child.stdout.take().expect("child stdout not piped");
    let mut reader = BufReader::new(stdout);
    let mut stderr = child.stderr.take().expect("child stderr not piped");

    let initialize_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "reload-stderr-test", "version": "0.0.0"}
        }
    });
    let mut line = serde_json::to_string(&initialize_request).unwrap();
    line.push('\n');
    timeout(Duration::from_secs(10), stdin.write_all(line.as_bytes()))
        .await
        .expect("timed out writing initialize request")
        .expect("failed to write initialize request");
    timeout(Duration::from_secs(10), stdin.flush())
        .await
        .expect("timed out flushing stdin")
        .expect("failed to flush stdin");

    let mut response_line = String::new();
    timeout(
        Duration::from_secs(10),
        reader.read_line(&mut response_line),
    )
    .await
    .expect("timed out waiting for initialize response")
    .expect("failed to read initialize response");
    assert!(
        serde_json::from_str::<serde_json::Value>(response_line.trim())
            .expect("initialize response was not valid JSON")
            .get("result")
            .is_some(),
        "expected initialize to succeed: {response_line}"
    );

    let initialized_notification = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });
    let mut notif_line = serde_json::to_string(&initialized_notification).unwrap();
    notif_line.push('\n');
    timeout(
        Duration::from_secs(10),
        stdin.write_all(notif_line.as_bytes()),
    )
    .await
    .expect("timed out writing initialized notification")
    .expect("failed to write initialized notification");
    timeout(Duration::from_secs(10), stdin.flush())
        .await
        .expect("timed out flushing stdin (initialized)")
        .expect("failed to flush stdin (initialized)");

    let reload_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {"name": "reload_skills", "arguments": {}}
    });
    let mut reload_line = serde_json::to_string(&reload_request).unwrap();
    reload_line.push('\n');
    timeout(
        Duration::from_secs(10),
        stdin.write_all(reload_line.as_bytes()),
    )
    .await
    .expect("timed out writing reload_skills request")
    .expect("failed to write reload_skills request");
    timeout(Duration::from_secs(10), stdin.flush())
        .await
        .expect("timed out flushing stdin (reload)")
        .expect("failed to flush stdin (reload)");

    let mut reload_response_line = String::new();
    timeout(
        Duration::from_secs(10),
        reader.read_line(&mut reload_response_line),
    )
    .await
    .expect("timed out waiting for reload_skills response")
    .expect("failed to read reload_skills response");
    let reload_response: serde_json::Value = serde_json::from_str(reload_response_line.trim())
        .expect("reload_skills response was not valid JSON");
    let result = reload_response
        .get("result")
        .expect("expected reload_skills to succeed");

    // The tool result carries its JSON payload as the sole text content
    // item -- unwrap through `result.content[0].text` to reach the
    // `indexed` field, matching how `json_content` reads it in the
    // `tool_handlers` unit tests.
    let content_text = result["content"][0]["text"]
        .as_str()
        .expect("expected a text content item in the tool result");
    let body: serde_json::Value =
        serde_json::from_str(content_text).expect("tool result content was not valid JSON");
    let indexed = body["indexed"]
        .as_u64()
        .expect("expected an 'indexed' field in the reload_skills response");

    drop(stdin);
    let mut stderr_buf = String::new();
    use tokio::io::AsyncReadExt;
    let _ = timeout(
        Duration::from_secs(10),
        stderr.read_to_string(&mut stderr_buf),
    )
    .await;
    let _ = timeout(Duration::from_secs(10), child.wait()).await;

    (indexed, stderr_buf)
}

#[tokio::test]
async fn reload_skills_emits_the_scan_diagnostic_to_stderr_like_startup_does() {
    let dir = std::env::temp_dir().join(format!(
        "skill-lookup-reload-stderr-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let skill_dir = dir.join("probe-skill");
    std::fs::create_dir_all(&skill_dir).expect("create skill dir");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: probe-skill\ndescription: d\n---\n\nBody.\n",
    )
    .expect("write SKILL.md");

    let (indexed, stderr_buf) = run_reload_and_capture(&dir, None).await;
    let _ = std::fs::remove_dir_all(&dir);

    // The startup scan (before any reload) already indexed the one probe
    // skill, so its own "scan complete" line is in stderr too -- assert
    // there are at least two occurrences of the summary phrase: one from
    // startup, one from this reload. A single occurrence would mean
    // reload never called `emit_to_stderr` and only the startup line is
    // present.
    let occurrences = stderr_buf.matches("scan complete").count();
    assert!(
        occurrences >= 2,
        "expected at least 2 'scan complete' lines in stderr (startup + reload), \
         got {occurrences}. Full stderr:\n{stderr_buf}"
    );
    assert!(
        stderr_buf.contains("indexed 1 skill(s)"),
        "expected the reload's diagnostic to report 1 indexed skill in stderr: {stderr_buf}"
    );
    assert_eq!(
        indexed, 1,
        "response 'indexed' must match stderr's effective count"
    );

    // No filter is active: the summary line must not grow a "filtered
    // out" clause just because `--skill-name-filter` exists as a flag.
    assert!(
        !stderr_buf.contains("filtered out"),
        "no filter is active; stderr must not mention filtering: {stderr_buf}"
    );
}

// f-e9ebf562: with a filter active, `model.rs::ScanDiagnostic::emit_to_stderr`
// used to print the RAW pre-filter `indexed_count`, while
// `main.rs::reload_skills`'s JSON response reported the NET post-filter
// count via `indexed`. Same event, two disagreeing numbers, no
// explanation. This proves both channels now agree on the effective
// count, and that stderr states the total/filtered/effective breakdown
// so the disagreement (there isn't one anymore) is self-explanatory.
#[tokio::test]
async fn reload_skills_with_filter_reports_total_filtered_and_effective_counts_in_stderr() {
    let base = std::env::temp_dir().join(format!(
        "skill-lookup-reload-filter-stderr-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    // Nested under `<base>/.konductor/skills`, with a sibling manifest
    // at `<base>/.konductor/manifest` marking all three skills
    // konductor-installed: `--skill-name-filter` only ever removes a
    // skill the install manifest says konductor itself installed (see
    // `scanner::apply_name_filter`'s doc comment) -- a skill with no
    // manifest entry always survives the filter regardless of its
    // value, so this test's "drop-me" would never actually get
    // filtered out without one.
    let dir = base.join(".konductor").join("skills");
    for name in ["keep-me", "keep-also", "drop-me"] {
        let skill_dir = dir.join(name);
        std::fs::create_dir_all(&skill_dir).expect("create skill dir");
        std::fs::write(
            skill_dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: d\n---\n\nBody.\n"),
        )
        .expect("write SKILL.md");
    }
    let manifest_files: Vec<String> = ["keep-me", "keep-also", "drop-me"]
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

    let (indexed, stderr_buf) = run_reload_and_capture(&dir, Some("keep-*")).await;
    let _ = std::fs::remove_dir_all(&base);

    // 3 total indexed, 1 ("drop-me") filtered out, 2 effective.
    assert_eq!(
        indexed, 2,
        "response 'indexed' must be the effective (post-filter) count: {stderr_buf}"
    );

    // The reload's own summary line (the second "scan complete"
    // occurrence) must state all three numbers and let the effective
    // count be read off directly.
    let reload_line = stderr_buf
        .lines()
        .filter(|l| l.contains("scan complete"))
        .nth(1)
        .unwrap_or_else(|| {
            panic!("expected a second 'scan complete' line (the reload's own): {stderr_buf}")
        });
    assert!(
        reload_line.contains("indexed 2 skill(s)"),
        "stderr must report the effective count matching the response's 'indexed': {reload_line}"
    );
    assert!(
        reload_line.contains("3 total"),
        "stderr must report the raw total indexed before filtering: {reload_line}"
    );
    assert!(
        reload_line.contains("1 filtered out"),
        "stderr must report how many were filtered out: {reload_line}"
    );
    assert!(
        reload_line.contains("--skill-name-filter"),
        "stderr must attribute the filtering to --skill-name-filter: {reload_line}"
    );
}
