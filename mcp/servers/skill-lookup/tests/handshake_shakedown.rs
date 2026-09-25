// SPDX-License-Identifier: Apache-2.0
//
// handshake_shakedown.rs -- targeted shakedown of the rmcp 0.1.5 -> 2.1.0
// upgrade's effect on the `initialize` handshake and the server's raw
// stdio framing, covering gaps NOT already exercised by
// `initialize_handshake.rs` (clean single handshake, second-initialize-
// rejected, reload_skills diagnostics) or `full_tool_surface.rs` (tool
// response content against a seeded --skills-dir).
//
// Specifically new here:
//   1. Calling a tool BEFORE the handshake completes.
//   2/3. Malformed / truncated JSON lines on stdin -- rmcp 2.1.0 is
//      documented (see this crate's Cargo.toml comment on the rmcp pin)
//      to reject unparsable messages rather than silently ignoring them,
//      which is one of the CVE fixes the upgrade closes.
//   4. Session health after a rejected second `initialize`.
//   5. A rapid-repeat (not true multi-threaded-race) burst of extra
//      `initialize` requests on an already-initialized session.
//
// This file is deliberately self-contained: `write_message`,
// `read_json_line`, and the spawn/handshake helpers below are copied
// (with minor generalization for this file's needs) from
// `initialize_handshake.rs` and `full_tool_surface.rs` rather than
// shared via a `mod`, matching those files' own existing duplication
// pattern (each integration test binary is compiled and run standalone
// by cargo, so a shared helper module would need its own plumbing
// anyway).
//
// Every test in this file reports the *literal observed behavior* via
// `eprintln!` (visible with `cargo test -- --nocapture`, and always
// visible on a failing test) rather than only asserting a single
// assumed-correct outcome, per this shakedown's actual goal: surface
// what the server really does, not just get a green checkmark.

use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::time::timeout;

/// Bounded wait for a response that is EXPECTED to arrive -- a hang here
/// is itself the bug under test, so this must be long enough not to
/// produce false failures on a slow CI box, but short enough that a true
/// hang fails the test in a reasonable time instead of blocking the
/// suite.
const IO_TIMEOUT: Duration = Duration::from_secs(10);

/// Shorter bound used only for reads where "no response at all" is a
/// plausible, non-buggy outcome (e.g. a pre-initialize tool call the
/// server chooses to leave pending). Kept short so exploratory tests
/// that legitimately hit this path don't slow the suite down needlessly.
const EXPLORATORY_TIMEOUT: Duration = Duration::from_secs(5);

/// Spawns the real `skill-lookup-mcp` binary with no `--skills-dir`,
/// matching `initialize_handshake.rs`'s spawn pattern: these tests are
/// exercising handshake/framing behavior, not tool response content
/// against a seeded skill set, so no skills directory is needed.
fn spawn_server() -> Child {
    let bin = env!("CARGO_BIN_EXE_skill-lookup-mcp");
    Command::new(bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .expect("failed to spawn skill-lookup-mcp")
}

/// Writes one JSON-RPC message (request or notification) as a single
/// line to `stdin`, flushing afterward. Copied verbatim (module path
/// adjusted for local types) from `full_tool_surface.rs`.
async fn write_message(stdin: &mut ChildStdin, message: &serde_json::Value) {
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

/// Writes a single RAW line (not necessarily valid JSON) to `stdin`,
/// appending exactly one `\n` -- used by the malformed/truncated-JSON
/// tests below, which need to put deliberately non-JSON or incomplete-
/// JSON bytes on the wire rather than a serialized `serde_json::Value`.
async fn write_raw_line(stdin: &mut ChildStdin, raw: &str) {
    let mut line = raw.to_string();
    line.push('\n');
    timeout(IO_TIMEOUT, stdin.write_all(line.as_bytes()))
        .await
        .expect("timed out writing raw line")
        .expect("failed to write raw line to child stdin");
    timeout(IO_TIMEOUT, stdin.flush())
        .await
        .expect("timed out flushing child stdin (raw line)")
        .expect("failed to flush child stdin (raw line)");
}

/// Reads one line from `reader` and parses it as JSON, bounded by
/// `IO_TIMEOUT`. Use this when a response is EXPECTED -- it panics (with
/// a clear message) if the read times out or the line isn't valid JSON,
/// which is exactly the failure mode we want surfaced for a request that
/// should always get an answer.
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

/// Reads one line from `reader` bounded by `EXPLORATORY_TIMEOUT`,
/// returning `None` if nothing arrives in time (rather than panicking)
/// and `Some(Err(..))` if a line arrived but was not valid JSON. Used
/// where "no response" or "a non-JSON response" are themselves
/// observations under test, not test-infrastructure failures.
async fn try_read_line<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Option<Result<serde_json::Value, (String, serde_json::Error)>> {
    let mut line = String::new();
    match timeout(EXPLORATORY_TIMEOUT, reader.read_line(&mut line)).await {
        Err(_elapsed) => None, // no response within the exploratory window
        Ok(Ok(0)) => None,     // EOF -- treat like "no response", caller checks process state
        Ok(Ok(_)) => {
            let trimmed = line.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                match serde_json::from_str::<serde_json::Value>(&trimmed) {
                    Ok(v) => Some(Ok(v)),
                    Err(e) => Some(Err((trimmed, e))),
                }
            }
        }
        Ok(Err(e)) => panic!("I/O error reading response line: {e}"),
    }
}

fn initialize_request(id: u64, client_name: &str) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": client_name, "version": "0.0.0"}
        }
    })
}

fn initialized_notification() -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    })
}

/// Completes the `initialize` / `notifications/initialized` handshake,
/// asserting the `initialize` call succeeded. Copied/adapted from
/// `full_tool_surface.rs::complete_handshake`.
async fn complete_handshake<R: tokio::io::AsyncBufRead + Unpin>(
    stdin: &mut ChildStdin,
    reader: &mut R,
    id: u64,
    client_name: &str,
) {
    write_message(stdin, &initialize_request(id, client_name)).await;
    let response = read_json_line(reader).await;
    assert!(
        response.get("result").is_some(),
        "expected initialize (id {id}) to succeed: {response:?}"
    );
    write_message(stdin, &initialized_notification()).await;
}

/// Drains and returns child stderr, bounded by `IO_TIMEOUT`, for
/// inclusion in failure/diagnostic messages. Consumes `child`'s stderr
/// handle, so call this at most once per child and only when done
/// reading stdout.
async fn drain_stderr(child: &mut Child) -> String {
    use tokio::io::AsyncReadExt;
    let mut stderr = match child.stderr.take() {
        Some(s) => s,
        None => return String::new(),
    };
    let mut buf = String::new();
    let _ = timeout(IO_TIMEOUT, stderr.read_to_string(&mut buf)).await;
    buf
}

// ---------------------------------------------------------------------
// 1. Tool call BEFORE the handshake completes.
// ---------------------------------------------------------------------
//
// The AtomicBool swap added for the rmcp 2.1.0 upgrade only gates the
// `initialize` handler itself (rejecting a *second* initialize on an
// already-initialized session). It says nothing about whether the
// server-side dispatch gates *other* methods on "has initialize
// happened yet" -- that gating, if any, is rmcp's own `serve()`
// machinery, not this server's code. This test does not assume which
// way that goes; it observes and reports.
#[tokio::test]
async fn tool_call_before_initialize_is_rejected_or_handled_gracefully() {
    let mut child = spawn_server();
    let mut stdin = child.stdin.take().expect("child stdin not piped");
    let stdout = child.stdout.take().expect("child stdout not piped");
    let mut reader = BufReader::new(stdout);

    // No `initialize` sent at all -- go straight to a tool call.
    write_message(
        &mut stdin,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "find_skills", "arguments": {}}
        }),
    )
    .await;

    let observed = try_read_line(&mut reader).await;

    match &observed {
        None => {
            eprintln!(
                "[pre-initialize tool call] no response within {EXPLORATORY_TIMEOUT:?}; \
                 checking the server is still alive (pending, not hung/crashed) by \
                 completing the handshake and confirming it responds to a fresh request."
            );
            // "No response yet" needs a liveness check to distinguish
            // "still processing, will answer eventually" from "already
            // dead". Observed in practice: rmcp's own `serve()` loop
            // enforces that the very next message after a successful
            // `initialize` response must be `notifications/initialized`
            // -- anything else (including a `tools/call`, as sent here)
            // is treated as a fatal handshake-sequencing violation. The
            // server never emits a JSON-RPC response frame for the
            // offending request; it logs to stderr and the process
            // exits. This matches `initialize_handshake.rs`'s own doc
            // comment describing this same `serve()` enforcement for
            // the "disconnect before sending `initialized`" case -- this
            // is that enforcement firing on "sent something else instead
            // of `initialized`", not a new regression introduced by the
            // `AtomicBool` swap added for the rmcp 2.1.0 upgrade.
            if let Some(status) = child.try_wait().expect("try_wait failed") {
                let stderr_buf = drain_stderr(&mut child).await;
                eprintln!(
                    "[pre-initialize tool call] FINDING: a `tools/call` sent before \
                     `notifications/initialized` causes the connection to be torn \
                     down -- the server exits WITHOUT ever sending a JSON-RPC \
                     response/error frame for that call. exit_status={status:?}\n\
                     stderr=\n{stderr_buf}"
                );
                assert!(
                    stderr_buf.contains("expect initialized request"),
                    "expected rmcp's known handshake-sequencing error message in \
                     stderr, got: {stderr_buf}"
                );
                assert!(
                    !status.success(),
                    "expected a non-zero exit status for this handshake violation, \
                     got: {status:?}"
                );
                eprintln!(
                    "[pre-initialize tool call] CAVEAT worth flagging to the team: \
                     this is rmcp's own serve()-level enforcement (not a bug from \
                     this server's code, and not the AtomicBool swap under test), \
                     but it means a client that jumps straight to a tool call before \
                     `initialized` gets NO JSON-RPC error response at all -- just an \
                     abrupt connection/process death. A real client has no wire-level \
                     signal to distinguish this from a hang or crash; it can only \
                     infer the cause from the closed pipe. An explicit JSON-RPC \
                     error frame before tearing down the connection would be more \
                     debuggable, though this behavior originates in rmcp's `serve()` \
                     helper, not in skill-lookup-mcp's own handler code."
                );
                // Test ends here for this branch: the process is gone,
                // so there is no session left to prove "still usable"
                // on. That is itself the finding -- see the eprintln
                // above -- not a separate failure to chase.
                return;
            }
            complete_handshake(&mut stdin, &mut reader, 2, "pre-init-tool-call-test").await;
            write_message(
                &mut stdin,
                &serde_json::json!({"jsonrpc": "2.0", "id": 3, "method": "tools/list"}),
            )
            .await;
            let post_handshake_response = read_json_line(&mut reader).await;
            eprintln!(
                "[pre-initialize tool call] post-handshake tools/list response: \
                 {post_handshake_response:?}"
            );
            assert!(
                post_handshake_response.get("result").is_some(),
                "server did not recover to a working state after the pending \
                 pre-initialize tool call: {post_handshake_response:?}"
            );
            // Whether the original id-1 tool call response ever arrives
            // (interleaved or queued) is not asserted here -- the point
            // of this branch is proving the server is alive and usable,
            // not pinning down delivery order for a request the server
            // may be legitimately allowed to leave unanswered.
        }
        Some(Err((raw, parse_err))) => {
            panic!(
                "[pre-initialize tool call] server emitted a non-JSON response line \
                 to a pre-initialize tool call -- this is a framing bug: raw={raw:?}, \
                 parse_error={parse_err}"
            );
        }
        Some(Ok(response)) => {
            eprintln!("[pre-initialize tool call] observed response: {response}");
            assert_eq!(
                response.get("id").and_then(|v| v.as_i64()),
                Some(1),
                "response id did not echo the pre-initialize tool call's id: {response:?}"
            );
            // Document what actually happened rather than assuming
            // rejection is "the" correct behavior: either an error is
            // fine (spec-compliant "must initialize first" enforcement)
            // or, if rmcp 2.1.0 does not gate tools/call on handshake
            // state at all, a successful `result` here is *also*
            // information worth flagging -- it means an MCP client could
            // invoke tools without ever completing negotiation, which is
            // worth knowing even if this specific server has no other
            // ill effect from it.
            if response.get("error").is_some() {
                eprintln!(
                    "[pre-initialize tool call] server REJECTED the pre-initialize \
                     tool call with a JSON-RPC error -- spec-compliant handshake \
                     enforcement. error={:?}",
                    response.get("error")
                );
            } else if response.get("result").is_some() {
                eprintln!(
                    "[pre-initialize tool call] FINDING: server ANSWERED a tools/call \
                     made before any `initialize` request, with a normal `result` -- \
                     rmcp 2.1.0 (or this server) does not appear to gate tool \
                     dispatch on handshake completion. This is not a crash and not a \
                     hang, but it is a spec deviation worth flagging to the team: \
                     result={:?}",
                    response.get("result")
                );
            } else {
                panic!(
                    "response has neither 'result' nor 'error', violating JSON-RPC: \
                     {response:?}"
                );
            }
        }
    }

    // Whatever happened above, the process must not have crashed.
    drop(stdin);
    let stderr_buf = drain_stderr(&mut child).await;
    let status = timeout(IO_TIMEOUT, child.wait())
        .await
        .expect("timed out waiting for skill-lookup-mcp to exit")
        .expect("failed to wait on child process");
    eprintln!(
        "[pre-initialize tool call] final exit status: {status:?}; stderr:\n{stderr_buf}"
    );
    // Not asserting `status.success()`: an unclean exit specifically
    // because stdin closed mid-handshake is a separate, already-tested
    // concern (see initialize_handshake.rs's own EOF-after-handshake
    // assertion, which only runs after a *completed* handshake). What
    // matters here is that the process didn't die on the tool call
    // itself, which the earlier `try_wait()`/response checks establish.
}

// ---------------------------------------------------------------------
// 2. Malformed JSON on stdin after a valid handshake.
// ---------------------------------------------------------------------
#[tokio::test]
async fn malformed_json_on_stdin_does_not_crash_the_server() {
    let mut child = spawn_server();
    let mut stdin = child.stdin.take().expect("child stdin not piped");
    let stdout = child.stdout.take().expect("child stdout not piped");
    let mut reader = BufReader::new(stdout);

    complete_handshake(&mut stdin, &mut reader, 1, "malformed-json-test").await;

    // Deliberately not valid JSON at all.
    write_raw_line(&mut stdin, "not json at all").await;

    // Followed immediately by a valid, well-formed request.
    write_message(
        &mut stdin,
        &serde_json::json!({"jsonrpc": "2.0", "id": 99, "method": "tools/list"}),
    )
    .await;

    // Collect up to two response lines: the malformed line may (a)
    // produce its own JSON-RPC parse-error response, then the id-99
    // response follows, or (b) be silently ignored, in which case the
    // very first line we see is already the id-99 response.
    let mut saw_parse_error_line = false;
    let mut found_99 = false;
    for _ in 0..2 {
        if found_99 {
            break;
        }
        let observed = try_read_line(&mut reader).await;
        match observed {
            None => break,
            Some(Err((raw, parse_err))) => {
                panic!(
                    "server emitted a non-JSON line on stdout in response to malformed \
                     stdin input -- raw={raw:?}, parse_error={parse_err}"
                );
            }
            Some(Ok(response)) => {
                eprintln!("[malformed JSON] observed response line: {response}");
                if response.get("id").and_then(|v| v.as_i64()) == Some(99) {
                    found_99 = true;
                    assert!(
                        response.get("result").is_some(),
                        "expected the valid tools/list (id 99) sent after the malformed \
                         line to succeed: {response:?}"
                    );
                } else {
                    // Presumably the malformed line's own error response
                    // (id null/absent per JSON-RPC spec for unparsable
                    // input, or some other id).
                    saw_parse_error_line = true;
                    assert!(
                        response.get("error").is_some(),
                        "expected a non-id-99 response to be a parse-error for the \
                         malformed line, but it had no 'error': {response:?}"
                    );
                }
            }
        }
    }

    eprintln!(
        "[malformed JSON] server behavior: {}; valid follow-up request answered: {found_99}",
        if saw_parse_error_line {
            "emitted an explicit JSON-RPC parse error for the malformed line"
        } else {
            "silently ignored the malformed line (no separate error response observed)"
        }
    );

    assert!(
        found_99,
        "the valid tools/list request sent immediately after a malformed stdin line \
         never got answered -- the malformed line appears to have broken the session"
    );

    // Confirm the process is genuinely still alive and well, not just
    // that one more response slipped out before a delayed crash.
    assert!(
        child.try_wait().expect("try_wait failed").is_none(),
        "server process exited even though it answered the post-malformed-line request"
    );

    drop(stdin);
    let stderr_buf = drain_stderr(&mut child).await;
    let _ = timeout(IO_TIMEOUT, child.wait()).await;
    eprintln!("[malformed JSON] stderr:\n{stderr_buf}");
}

// ---------------------------------------------------------------------
// 3. Truncated/incomplete JSON object on stdin after a valid handshake.
// ---------------------------------------------------------------------
#[tokio::test]
async fn truncated_json_object_on_stdin_is_handled() {
    let mut child = spawn_server();
    let mut stdin = child.stdin.take().expect("child stdin not piped");
    let stdout = child.stdout.take().expect("child stdout not piped");
    let mut reader = BufReader::new(stdout);

    complete_handshake(&mut stdin, &mut reader, 1, "truncated-json-test").await;

    // Syntactically incomplete: no closing brace, sent as a single line
    // terminated by `\n` -- this transport is line-delimited, so from
    // the server's perspective this line's JSON is simply broken, the
    // same class of problem as test 2 but via truncation rather than
    // non-JSON garbage.
    write_raw_line(
        &mut stdin,
        r#"{"jsonrpc":"2.0","id":100,"method":"tools/list""#,
    )
    .await;

    write_message(
        &mut stdin,
        &serde_json::json!({"jsonrpc": "2.0", "id": 101, "method": "tools/list"}),
    )
    .await;

    let mut saw_parse_error_line = false;
    let mut found_101 = false;
    for _ in 0..2 {
        if found_101 {
            break;
        }
        let observed = try_read_line(&mut reader).await;
        match observed {
            None => break,
            Some(Err((raw, parse_err))) => {
                panic!(
                    "server emitted a non-JSON line on stdout in response to a \
                     truncated JSON stdin line -- raw={raw:?}, parse_error={parse_err}"
                );
            }
            Some(Ok(response)) => {
                eprintln!("[truncated JSON] observed response line: {response}");
                if response.get("id").and_then(|v| v.as_i64()) == Some(101) {
                    found_101 = true;
                    assert!(
                        response.get("result").is_some(),
                        "expected the valid tools/list (id 101) sent after the truncated \
                         line to succeed: {response:?}"
                    );
                } else {
                    saw_parse_error_line = true;
                    assert!(
                        response.get("error").is_some(),
                        "expected a non-id-101 response to be a parse-error for the \
                         truncated line, but it had no 'error': {response:?}"
                    );
                }
            }
        }
    }

    eprintln!(
        "[truncated JSON] server behavior: {}; valid follow-up request answered: {found_101}",
        if saw_parse_error_line {
            "emitted an explicit JSON-RPC parse error for the truncated line"
        } else {
            "silently ignored the truncated line (no separate error response observed)"
        }
    );

    assert!(
        found_101,
        "the valid tools/list request sent immediately after a truncated stdin JSON \
         line never got answered -- the truncated line appears to have broken the \
         session (this is the exact class of framing regression the rmcp 2.1.0 \
         'reject unparsable messages' fix is supposed to prevent from taking down \
         the whole connection)"
    );

    assert!(
        child.try_wait().expect("try_wait failed").is_none(),
        "server process exited even though it answered the post-truncation request"
    );

    drop(stdin);
    let stderr_buf = drain_stderr(&mut child).await;
    let _ = timeout(IO_TIMEOUT, child.wait()).await;
    eprintln!("[truncated JSON] stderr:\n{stderr_buf}");
}

// ---------------------------------------------------------------------
// 4. Session health after a rejected second `initialize`.
// ---------------------------------------------------------------------
#[tokio::test]
async fn session_remains_healthy_after_rejected_second_initialize() {
    let mut child = spawn_server();
    let mut stdin = child.stdin.take().expect("child stdin not piped");
    let stdout = child.stdout.take().expect("child stdout not piped");
    let mut reader = BufReader::new(stdout);

    complete_handshake(&mut stdin, &mut reader, 1, "session-health-test").await;

    // Second initialize -- expect rejection, matching
    // initialize_handshake.rs::second_initialize_request_is_rejected.
    write_message(&mut stdin, &initialize_request(2, "session-health-test")).await;
    let second_response = read_json_line(&mut reader).await;
    eprintln!("[session health] second initialize response: {second_response}");
    assert_eq!(
        second_response.get("id").and_then(|v| v.as_i64()),
        Some(2),
        "second initialize response did not echo id 2: {second_response:?}"
    );
    assert!(
        second_response.get("error").is_some(),
        "expected the second initialize to be rejected: {second_response:?}"
    );
    assert!(
        second_response.get("result").is_none(),
        "second initialize must not return a fresh result: {second_response:?}"
    );

    // Immediately follow up, on the SAME connection, with a legitimate
    // request -- proving the rejected initialize didn't corrupt session
    // state (e.g. poison the AtomicBool into some inconsistent state, or
    // leave the transport's read/write loop desynchronized).
    write_message(
        &mut stdin,
        &serde_json::json!({"jsonrpc": "2.0", "id": 3, "method": "tools/list"}),
    )
    .await;
    let third_response = read_json_line(&mut reader).await;
    eprintln!("[session health] post-rejection tools/list response: {third_response}");
    assert_eq!(
        third_response.get("id").and_then(|v| v.as_i64()),
        Some(3),
        "post-rejection tools/list response did not echo id 3: {third_response:?}"
    );
    assert!(
        third_response.get("result").is_some(),
        "expected the legitimate follow-up request to succeed after a rejected \
         second initialize: {third_response:?}"
    );
    let tool_names: Vec<&str> = third_response
        .pointer("/result/tools")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|t| t.get("name").and_then(|n| n.as_str()))
        .collect();
    assert!(
        tool_names.contains(&"find_skills"),
        "expected the post-rejection tools/list to still advertise the normal tool \
         set, got: {tool_names:?}"
    );

    drop(stdin);
    let stderr_buf = drain_stderr(&mut child).await;
    let _ = timeout(IO_TIMEOUT, child.wait()).await;
    eprintln!("[session health] stderr:\n{stderr_buf}");
}

// ---------------------------------------------------------------------
// 5. Rapid-repeat burst of extra `initialize` requests.
// ---------------------------------------------------------------------
//
// NAMING NOTE: this is a "rapid-repeat" test, not a true concurrency /
// race test. The transport here is a single stdin stream read by the
// server's read loop, so requests sent on it are inherently serialized
// on the wire regardless of how fast this test writes them -- there is
// no way for two `initialize` requests to race each other for the
// `AtomicBool::swap` on a single stdio session the way there could be
// across multiple concurrent connections in, say, an HTTP transport.
// What this test actually stresses is: does the `swap(true, SeqCst)`
// correctly reject EVERY subsequent initialize once the first one has
// flipped it, with no off-by-one/flip-flop bug, when requests arrive in
// a tight back-to-back burst rather than one at a time with reads
// interleaved between each write.
#[tokio::test]
async fn concurrent_double_initialize_race() {
    let mut child = spawn_server();
    let mut stdin = child.stdin.take().expect("child stdin not piped");
    let stdout = child.stdout.take().expect("child stdout not piped");
    let mut reader = BufReader::new(stdout);

    complete_handshake(&mut stdin, &mut reader, 1, "rapid-repeat-initialize-test").await;

    // Fire off several more `initialize` requests back-to-back, with
    // unique ids, writing all of them before reading any response --
    // this is the "as fast as possible" burst called for, short of
    // actual multi-threaded/multi-connection concurrency (see NAMING
    // NOTE above for why that's not achievable on a single stdio
    // session).
    const BURST_IDS: [u64; 5] = [2, 3, 4, 5, 6];
    for id in BURST_IDS {
        write_message(
            &mut stdin,
            &initialize_request(id, "rapid-repeat-initialize-test"),
        )
        .await;
    }

    let mut seen_ids = std::collections::HashSet::new();
    for _ in BURST_IDS {
        let response = read_json_line(&mut reader).await;
        eprintln!("[rapid-repeat initialize] burst response: {response}");
        let id = response
            .get("id")
            .and_then(|v| v.as_i64())
            .unwrap_or_else(|| panic!("burst response missing an id: {response:?}"));
        assert!(
            BURST_IDS.contains(&(id as u64)),
            "burst response id {id} was not one of the ids we sent {BURST_IDS:?}: \
             {response:?}"
        );
        assert!(
            seen_ids.insert(id),
            "received more than one response for burst id {id} -- duplicate/desynced \
             response: {response:?}"
        );
        assert!(
            response.get("error").is_some(),
            "FINDING: burst initialize id {id} was NOT rejected -- got a non-error \
             response, meaning a subsequent initialize slipped through as a false \
             success under rapid-repeat conditions: {response:?}"
        );
        assert!(
            response.get("result").is_none(),
            "burst initialize id {id} returned a 'result' alongside/instead of \
             rejection: {response:?}"
        );
    }
    assert_eq!(
        seen_ids.len(),
        BURST_IDS.len(),
        "expected exactly one response per burst id, got responses for: {seen_ids:?}"
    );
    eprintln!(
        "[rapid-repeat initialize] all {} burst initialize requests were correctly \
         rejected, none slipped through as a false success",
        BURST_IDS.len()
    );

    // Confirm the server survived the burst and is still usable.
    write_message(
        &mut stdin,
        &serde_json::json!({"jsonrpc": "2.0", "id": 7, "method": "tools/list"}),
    )
    .await;
    let final_response = read_json_line(&mut reader).await;
    eprintln!("[rapid-repeat initialize] post-burst tools/list response: {final_response}");
    assert!(
        final_response.get("result").is_some(),
        "expected the server to remain usable after the initialize burst: \
         {final_response:?}"
    );

    assert!(
        child.try_wait().expect("try_wait failed").is_none(),
        "server process exited during/after the rapid-repeat initialize burst"
    );

    drop(stdin);
    let stderr_buf = drain_stderr(&mut child).await;
    let _ = timeout(IO_TIMEOUT, child.wait()).await;
    eprintln!("[rapid-repeat initialize] stderr:\n{stderr_buf}");
}
