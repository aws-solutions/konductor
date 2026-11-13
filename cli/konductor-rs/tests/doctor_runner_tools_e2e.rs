// SPDX-License-Identifier: Apache-2.0
//
// doctor_runner_tools_e2e.rs: drives the REAL compiled binary through `konductor doctor` with a fake `kiro-cli` or
// `claude` on PATH, to check the minimum-version check of the runner tools. The fake is a shell script, so these tests start
// processes and live in their own test binary.
//
// Isolation: `HOME` and the install target are scratch directories, so nothing of the user's is read. `--no-version-check`
// is given so no command reaches the network.

#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-doctor-runner-e2e-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// The lowest `claude` version that the conformance checks passed on, as `doctor` pins it.
const CLAUDE_MINIMUM: &str = "2.1.323";

/// `doctor_tool` for `kiro-cli`.
fn doctor(label: &str, body: Option<&str>) -> (Output, serde_json::Value, Duration) {
    doctor_tool("kiro-cli", label, body)
}

/// Runs `konductor doctor --json` with a program `tool` whose body is `body` first on PATH, or with none on PATH when
/// `body` is `None`.
fn doctor_tool(
    tool_name: &str,
    label: &str,
    body: Option<&str>,
) -> (Output, serde_json::Value, Duration) {
    let (home, target, bin) = (
        scratch_dir(&format!("{label}-home")),
        scratch_dir(&format!("{label}-target")),
        scratch_dir(&format!("{label}-bin")),
    );
    if let Some(body) = body {
        let tool = bin.join(tool_name);
        std::fs::write(&tool, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let sink = telemetry_test_sink::TelemetrySink::start();
    let mut output = None;
    let begun = Instant::now();
    // A script that was just written can be busy for a moment, and that reads as an unreadable version.
    for _ in 0..20 {
        let mut command = Command::new(env!("CARGO_BIN_EXE_konductor"));
        command
            .args(["doctor", "--json", "--no-version-check", "--target"])
            .arg(&target)
            .env("HOME", &home)
            // Only the fake tool's folder and the system folders, so the user's real kiro-cli is never found.
            .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
            .env_remove("NO_COLOR")
            .stdin(Stdio::null());
        for var in sink.env_vars() {
            command.env(var.name, var.value);
        }
        let run = command.output().expect("spawn konductor");
        let text = String::from_utf8_lossy(&run.stdout).to_string();
        if text.contains("Text file busy") {
            std::thread::sleep(Duration::from_millis(50));
            continue;
        }
        output = Some(run);
        break;
    }
    let took = begun.elapsed();
    let output = output.expect("doctor ran");
    let doc: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("doctor --json prints JSON");
    for dir in [home, target, bin] {
        std::fs::remove_dir_all(dir).ok();
    }
    (output, doc, took)
}

fn named_check<'a>(doc: &'a serde_json::Value, name: &str) -> &'a serde_json::Value {
    let checks = doc["runner_tools"].as_array().expect("runner_tools array");
    checks
        .iter()
        .find(|c| c["name"] == name)
        .unwrap_or_else(|| panic!("the {name} check"))
}

fn runner_check(doc: &serde_json::Value) -> &serde_json::Value {
    named_check(doc, "kiro_cli_version")
}

#[test]
fn a_version_at_or_above_the_minimum_is_ok() {
    for printed in [
        "kiro-cli 3.3.0",
        "kiro-cli 3.3.1",
        "kiro-cli 3.10.0",
        "kiro-cli 4.0.0-beta.2",
    ] {
        let (_, doc, _) = doctor("ok", Some(&format!("echo '{printed}'")));
        assert_eq!(runner_check(&doc)["status"], "ok", "{printed}: {doc}");
    }
}

#[test]
fn a_version_below_the_minimum_is_a_warning_that_does_not_change_the_exit_code() {
    let (ok_run, _, _) = doctor("exit-ok", Some("echo 'kiro-cli 3.3.0'"));
    for printed in ["kiro-cli 3.2.9", "kiro-cli 2.34.0", "3"] {
        let (run, doc, _) = doctor("below", Some(&format!("echo '{printed}'")));
        let check = runner_check(&doc);
        assert_eq!(check["status"], "warn", "{printed}");
        assert!(check["summary"]
            .as_str()
            .unwrap()
            .contains("below the minimum 3.3.0"));
        assert!(check["remediation"]
            .as_str()
            .unwrap()
            .contains("update kiro-cli"));
        assert_eq!(doc["warnings"], true);
        assert_eq!(run.status.code(), ok_run.status.code(), "{printed}");
    }
}

#[test]
fn a_version_that_cannot_be_read_is_a_warning_and_a_hung_one_is_stopped() {
    for (body, hangs) in [
        ("echo 'no number here'", false),
        ("exit 3", false),
        ("sleep 60", true),
    ] {
        let (run, doc, took) = doctor("unreadable", Some(body));
        let check = runner_check(&doc);
        assert_eq!(check["status"], "warn", "{body}: {doc}");
        assert!(check["summary"]
            .as_str()
            .unwrap()
            .contains("could not be read"));
        assert!(run.status.code().is_some_and(|c| c != 2), "{body}");
        if hangs {
            // The check waits 5 seconds for `--version` and then kills it. Nothing waits for the full 60.
            assert!(took < Duration::from_secs(30), "{took:?}");
        }
    }
}

#[test]
fn a_tool_that_is_not_installed_is_info_and_the_check_is_not_skipped_by_no_version_check() {
    let (_, doc, _) = doctor("absent", None);
    let check = runner_check(&doc);
    assert_eq!(check["status"], "info", "{doc}");
    assert!(check["summary"]
        .as_str()
        .unwrap()
        .contains("not found on PATH"));
}

#[test]
fn the_plain_report_lists_the_check_once_next_to_cli_version() {
    let (home, target, bin) = (
        scratch_dir("plain-home"),
        scratch_dir("plain-target"),
        scratch_dir("plain-bin"),
    );
    let tool = bin.join("kiro-cli");
    std::fs::write(&tool, "#!/bin/sh\necho 'kiro-cli 3.3.0'\n").unwrap();
    std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
    let sink = telemetry_test_sink::TelemetrySink::start();
    let mut command = Command::new(env!("CARGO_BIN_EXE_konductor"));
    command
        .args(["doctor", "--no-version-check", "--target"])
        .arg(&target)
        .env("HOME", &home)
        .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
        .stdin(Stdio::null());
    for var in sink.env_vars() {
        command.env(var.name, var.value);
    }
    let run = command.output().unwrap();
    let text = String::from_utf8_lossy(&run.stdout);
    assert_eq!(text.matches("kiro_cli_version").count(), 1, "{text}");

    // Under `--all` it is a machine-wide check too: once, however many installs are tracked.
    let (a, b) = (scratch_dir("plain-a"), scratch_dir("plain-b"));
    std::fs::create_dir_all(home.join(".konductor")).unwrap();
    let entry = |dir: &PathBuf| {
        format!(
            r#"{{"target_dir":"{}","strategies":["kiro-v3"],"installed_at":"2026-11-01T00:00:00Z","status":"complete"}}"#,
            dir.display()
        )
    };
    std::fs::write(
        home.join(".konductor/installs"),
        format!(
            r#"{{"schema_version":2,"installs":[{},{}]}}"#,
            entry(&a),
            entry(&b)
        ),
    )
    .unwrap();
    let mut all = Command::new(env!("CARGO_BIN_EXE_konductor"));
    all.args(["doctor", "--all", "--no-version-check"])
        .env("HOME", &home)
        .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
        .stdin(Stdio::null());
    for var in sink.env_vars() {
        all.env(var.name, var.value);
    }
    let run = all.output().unwrap();
    let text = String::from_utf8_lossy(&run.stdout);
    assert!(text.contains(&format!("== {} ==", a.display())), "{text}");
    assert_eq!(text.matches("kiro_cli_version").count(), 1, "{text}");
    for dir in [a, b] {
        std::fs::remove_dir_all(dir).ok();
    }
    for dir in [home, target, bin] {
        std::fs::remove_dir_all(dir).ok();
    }
}

#[test]
fn the_claude_row_is_ok_at_the_minimum_a_warning_below_it_and_info_when_absent() {
    let (_, doc, _) = doctor_tool(
        "claude",
        "claude-ok",
        Some(&format!("echo '{CLAUDE_MINIMUM} (Claude Code)'")),
    );
    assert_eq!(named_check(&doc, "claude_version")["status"], "ok", "{doc}");
    // The Kiro row is there too, and reads as absent.
    assert_eq!(runner_check(&doc)["status"], "info", "{doc}");

    let (ok_run, _, _) = doctor_tool("claude", "claude-exit-ok", Some("echo '99.0.0'"));
    let (run, doc, _) = doctor_tool("claude", "claude-below", Some("echo '1.0.0 (Claude Code)'"));
    let check = named_check(&doc, "claude_version");
    assert_eq!(check["status"], "warn", "{doc}");
    assert!(check["summary"]
        .as_str()
        .unwrap()
        .contains(&format!("below the minimum {CLAUDE_MINIMUM}")));
    assert!(check["remediation"]
        .as_str()
        .unwrap()
        .contains("update claude"));
    assert_eq!(doc["warnings"], true);
    assert_eq!(run.status.code(), ok_run.status.code());

    let (_, doc, _) = doctor_tool("claude", "claude-absent", None);
    let check = named_check(&doc, "claude_version");
    assert_eq!(check["status"], "info", "{doc}");
    assert!(check["summary"]
        .as_str()
        .unwrap()
        .contains("claude not found on PATH"));
}

#[test]
fn a_version_with_four_numbers_is_read_by_its_first_three() {
    let (_, doc, _) = doctor_tool(
        "claude",
        "claude-four",
        Some("echo '99.1.2.3456 (Claude Code)'"),
    );
    let check = named_check(&doc, "claude_version");
    assert_eq!(check["status"], "ok", "{doc}");
    assert!(check["summary"].as_str().unwrap().contains("99.1.2 "));
}
