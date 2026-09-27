// SPDX-License-Identifier: Apache-2.0
//
// find_skills_shakedown.rs — targeted regression coverage for the
// `find_skills` MCP tool after the `rmcp` 0.1.5 -> 2.1.0 bump.
//
// `full_tool_surface.rs` already proves `find_skills` works end-to-end
// against a single seeded skill with no filters. This file seeds a
// richer, multi-skill fixture directory (varied names/descriptions/tags,
// including a no-tags skill and a tag that is a superstring of another
// skill's tag) so the filter logic itself — name substring, keyword
// substring-across-name-or-description, tag exact match, AND semantics
// across filters, empty-string rejection, unknown-parameter rejection,
// and the empty-array-not-error "no matches" contract — actually has
// something to differentiate. It is deliberately self-contained: the
// spawn/write/read-line JSON-RPC framing helpers below are copied
// verbatim from `full_tool_surface.rs` rather than shared, matching that
// file's own stated pattern (each integration-test binary in this crate
// is independently runnable and carries its own copies).

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::timeout;

const IO_TIMEOUT: Duration = Duration::from_secs(10);

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
                "clientInfo": {"name": "find-skills-shakedown-test", "version": "0.0.0"}
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

/// Writes one skill's `SKILL.md` under `<dir>/<name>/SKILL.md`, in the
/// same frontmatter shape real skills in this repo's own `skills/` tree
/// use (`name`/`description`/`version`/`tags: [...]`). `tags` may be
/// empty, in which case the `tags:` key is omitted entirely — matching
/// how a real tagless skill file looks, not an explicit `tags: []`.
fn write_skill(dir: &Path, name: &str, description: &str, tags: &[&str]) {
    let skill_dir = dir.join(name);
    std::fs::create_dir_all(&skill_dir).expect("create skill dir");
    let tags_line = if tags.is_empty() {
        String::new()
    } else {
        format!("\ntags: [{}]", tags.join(", "))
    };
    std::fs::write(
        skill_dir.join("SKILL.md"),
        format!(
            "---\nname: {name}\ndescription: {description}\nversion: 1.0.0{tags_line}\n---\n\n# {name}\n\nBody text for {name}.\n"
        ),
    )
    .expect("write SKILL.md");
}

/// Creates a fresh temp directory containing five distinct skills whose
/// names/descriptions/tags are chosen so each `find_skills` filter
/// dimension has something to actually differentiate:
///
/// - `alpha-widget` (tags: infra, widget) — matched by name substring
///   "ALPHA" (mixed case) and by tag "infra".
/// - `beta-widget` (tags: infra, widget) — description carries the
///   unique marker `zulu-marker-unique`, present in no other skill's
///   name or description, used for the keyword-vs-description test;
///   also tagged "infra" alongside `alpha-widget` for the tag test.
/// - `gamma-tool` (tags: testing) — distinct name/tag namespace, used as
///   a negative control and for the well-formed-fields assertion.
/// - `delta-notag` (no tags at all) — proves the schema tolerates a
///   skill with an empty tag set and that it is correctly excluded by
///   any `tag` filter.
/// - `epsilon-tool` (tags: infra-extra) — `infra-extra` is a superstring
///   of the tag `infra` used above; this is the tag-exact-match-not-
///   substring negative control: filtering `tag=infra` must not match
///   this skill, and filtering `tag=infra-extra` must not be satisfied
///   by the other skills' plain `infra` tag either.
///
/// `label` disambiguates concurrent tests the same way
/// `full_tool_surface.rs`'s `seed_probe_skill_dir` does.
fn seed_multi_skill_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "skill-lookup-find-skills-shakedown-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time before UNIX epoch")
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).expect("create fixture root");

    write_skill(
        &dir,
        "alpha-widget",
        "Provisions widgets for the alpha rollout pipeline.",
        &["infra", "widget"],
    );
    write_skill(
        &dir,
        "beta-widget",
        "Coordinates the beta rollout, marker zulu-marker-unique for tests.",
        &["infra", "widget"],
    );
    write_skill(
        &dir,
        "gamma-tool",
        "A standalone QA utility for gamma-stage testing.",
        &["testing"],
    );
    write_skill(
        &dir,
        "delta-notag",
        "A skill with no tags at all, to prove that's tolerated.",
        &[],
    );
    write_skill(
        &dir,
        "epsilon-tool",
        "Extended infra tooling, tagged with a superstring of 'infra'.",
        &["infra-extra"],
    );

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

/// Runs `body(stdin, reader)` against a freshly spawned server over a
/// freshly seeded 5-skill fixture dir, then tears both down: closes
/// stdin, drains stderr for diagnostics, waits for clean exit, and
/// removes the temp dir.
async fn with_fixture_server<F, Fut>(label: &str, body: F)
where
    F: FnOnce(tokio::process::ChildStdin, BufReader<tokio::process::ChildStdout>) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let dir = TempDirGuard(seed_multi_skill_dir(label));
    let sink = telemetry_test_sink::TelemetrySink::start();
    let mut child = spawn_server(&dir.0, &sink);

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

/// Sends one `tools/call` for `find_skills` with `arguments`, id `2`,
/// and returns the raw JSON-RPC response (so both success and error
/// cases can be asserted on by the caller).
async fn call_find_skills<R: tokio::io::AsyncBufRead + Unpin>(
    stdin: &mut tokio::process::ChildStdin,
    reader: &mut R,
    arguments: serde_json::Value,
) -> serde_json::Value {
    write_message(
        stdin,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "find_skills", "arguments": arguments}
        }),
    )
    .await;
    let response = read_json_line(reader).await;
    assert_eq!(
        response.get("id").and_then(|v| v.as_i64()),
        Some(2),
        "find_skills response did not echo request id 2: {response:?}"
    );
    response
}

/// Extracts and parses the JSON array of `FindSkillsRecord`s from a
/// successful `find_skills` response, panicking with the full response
/// on any shape mismatch.
fn parse_find_skills_result(response: &serde_json::Value) -> Vec<serde_json::Value> {
    let result = response
        .get("result")
        .unwrap_or_else(|| panic!("expected find_skills to succeed: {response:?}"));
    let content_text = result["content"][0]["text"]
        .as_str()
        .expect("expected a text content item in the find_skills result");
    serde_json::from_str(content_text).expect("find_skills content was not a JSON array")
}

fn record_names(records: &[serde_json::Value]) -> Vec<&str> {
    records
        .iter()
        .filter_map(|r| r.get("name").and_then(|v| v.as_str()))
        .collect()
}

#[tokio::test]
async fn find_skills_by_name_substring_matches_case_insensitively() {
    with_fixture_server("name-substring", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        // Mixed-case, partial substring of "alpha-widget" ("ALPHA" is
        // neither the full name nor lowercase).
        let response =
            call_find_skills(&mut stdin, &mut reader, serde_json::json!({"name": "ALPHA"})).await;
        let records = parse_find_skills_result(&response);
        let names = record_names(&records);
        assert_eq!(
            names,
            vec!["alpha-widget"],
            "expected only 'alpha-widget' to match a case-insensitive substring of its name, got: {records:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn find_skills_by_keyword_matches_against_description_too() {
    with_fixture_server("keyword-description", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        // "zulu-marker-unique" appears only in beta-widget's
        // *description*, in no skill's name.
        let response = call_find_skills(
            &mut stdin,
            &mut reader,
            serde_json::json!({"keyword": "zulu-marker-unique"}),
        )
        .await;
        let records = parse_find_skills_result(&response);
        let names = record_names(&records);
        assert_eq!(
            names,
            vec!["beta-widget"],
            "expected the keyword to match only via beta-widget's description, got: {records:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn find_skills_by_tag_is_exact_not_substring() {
    with_fixture_server("tag-exact", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        // "infra" must match alpha-widget and beta-widget (tagged
        // exactly "infra") but NOT epsilon-tool, which is tagged
        // "infra-extra" — a superstring of the filter, not an exact
        // match.
        let response =
            call_find_skills(&mut stdin, &mut reader, serde_json::json!({"tag": "infra"})).await;
        let records = parse_find_skills_result(&response);
        let mut names = record_names(&records);
        names.sort_unstable();
        assert_eq!(
            names,
            vec!["alpha-widget", "beta-widget"],
            "tag filter 'infra' must exact-match, excluding the 'infra-extra' superstring tag: {records:?}"
        );

        // Converse direction: filtering on the longer tag must not be
        // satisfied by the shorter one either.
        let response = call_find_skills(
            &mut stdin,
            &mut reader,
            serde_json::json!({"tag": "infra-extra"}),
        )
        .await;
        let records = parse_find_skills_result(&response);
        let names = record_names(&records);
        assert_eq!(
            names,
            vec!["epsilon-tool"],
            "tag filter 'infra-extra' must match only its own exact tag, not any plain 'infra'-tagged skill: {records:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn find_skills_with_multiple_filters_uses_and_semantics() {
    with_fixture_server("and-semantics", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        // name="widget" alone matches {alpha-widget, beta-widget}.
        // keyword="zulu-marker-unique" alone matches {beta-widget}.
        // The AND of both must narrow to exactly {beta-widget}, proving
        // this isn't OR (which would still return both widget skills,
        // or every skill matching either filter).
        let response = call_find_skills(
            &mut stdin,
            &mut reader,
            serde_json::json!({"name": "widget", "keyword": "zulu-marker-unique"}),
        )
        .await;
        let records = parse_find_skills_result(&response);
        let names = record_names(&records);
        assert_eq!(
            names,
            vec!["beta-widget"],
            "expected AND semantics to narrow to the single intersection match, got: {records:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn find_skills_empty_string_filter_is_rejected() {
    with_fixture_server("empty-string-filter", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        // An explicit empty string is distinct from omitting the key —
        // must be rejected, not silently treated as "no filter".
        let response =
            call_find_skills(&mut stdin, &mut reader, serde_json::json!({"name": ""})).await;
        assert!(
            response.get("result").is_none(),
            "an empty-string 'name' filter must not succeed: {response:?}"
        );
        let error = response
            .get("error")
            .unwrap_or_else(|| panic!("expected a JSON-RPC error for an empty 'name': {response:?}"));
        let message = error
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("expected an error message: {error:?}"));
        assert!(
            message.contains("must not be empty"),
            "expected the empty-string rejection message to explain the constraint, got: {message:?} (full error: {error:?})"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn find_skills_unknown_parameter_is_rejected() {
    with_fixture_server("unknown-parameter", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        let response =
            call_find_skills(&mut stdin, &mut reader, serde_json::json!({"bogus": "x"})).await;
        assert!(
            response.get("result").is_none(),
            "an unknown parameter must not succeed: {response:?}"
        );
        let error = response
            .get("error")
            .unwrap_or_else(|| panic!("expected a JSON-RPC error for an unknown parameter: {response:?}"));
        let message = error
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("expected an error message: {error:?}"));
        assert!(
            message.contains("unknown parameter"),
            "expected the rejection message to mention 'unknown parameter', got: {message:?} (full error: {error:?})"
        );
        assert!(
            message.contains("bogus"),
            "expected the rejection message to name the offending key 'bogus', got: {message:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn find_skills_no_matches_returns_empty_array_not_error() {
    with_fixture_server("no-matches", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        let response = call_find_skills(
            &mut stdin,
            &mut reader,
            serde_json::json!({"name": "does-not-exist-anywhere"}),
        )
        .await;
        assert!(
            response.get("error").is_none(),
            "a non-matching filter must not be a tool-level error: {response:?}"
        );
        let records = parse_find_skills_result(&response);
        assert!(
            records.is_empty(),
            "expected an empty array for no matches, got: {records:?}"
        );

        drop(stdin);
    })
    .await;
}

#[tokio::test]
async fn find_skills_result_fields_are_well_formed() {
    with_fixture_server("well-formed-fields", |mut stdin, mut reader| async move {
        complete_handshake(&mut stdin, &mut reader).await;

        let response =
            call_find_skills(&mut stdin, &mut reader, serde_json::json!({"name": "gamma"})).await;
        let records = parse_find_skills_result(&response);
        assert_eq!(
            records.len(),
            1,
            "expected exactly one match for 'gamma', got: {records:?}"
        );
        let record = &records[0];

        let name = record
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("expected non-empty string 'name': {record:?}"));
        assert!(!name.is_empty(), "'name' must not be empty: {record:?}");
        assert_eq!(name, "gamma-tool");

        let description = record
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("expected non-empty string 'description': {record:?}"));
        assert!(
            !description.is_empty(),
            "'description' must not be empty: {record:?}"
        );

        let tags = record
            .get("tags")
            .and_then(|v| v.as_array())
            .unwrap_or_else(|| panic!("expected a 'tags' array: {record:?}"));
        let tag_names: Vec<&str> = tags.iter().filter_map(|t| t.as_str()).collect();
        assert_eq!(
            tag_names,
            vec!["testing"],
            "expected gamma-tool's single 'testing' tag: {record:?}"
        );

        let provenance = record
            .get("provenance")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("expected string 'provenance': {record:?}"));
        assert_eq!(
            provenance, "managed",
            "expected 'managed' provenance for the first --skills-dir: {record:?}"
        );

        let size_bytes = record
            .get("size_bytes")
            .and_then(|v| v.as_u64())
            .unwrap_or_else(|| panic!("expected numeric 'size_bytes' > 0: {record:?}"));
        assert!(
            size_bytes > 0,
            "expected a positive size_bytes for a real SKILL.md, got {size_bytes}"
        );

        drop(stdin);
    })
    .await;
}
