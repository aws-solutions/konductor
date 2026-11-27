// SPDX-License-Identifier: Apache-2.0
//
// doctor_acp_e2e.rs: drives the REAL compiled binary through `konductor doctor` with a fake `kiro-cli` or
// `claude-agent-acp` on PATH, to check the row of each ACP adapter: present, version, in range.
//
// Isolation: `HOME` and the install target are scratch directories, so nothing of the user's is read, and PATH holds
// the fake tool's folder and the system folders only. `--no-version-check` is given so no command reaches the
// network.

#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::time::Duration;

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-doctor-acp-e2e-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Runs `konductor doctor --json` with the programs of `tools` (a name and what `--version` prints) first on PATH.
fn doctor(label: &str, tools: &[(&str, &str)]) -> (Output, serde_json::Value) {
    let (home, target, bin) = (
        scratch_dir(&format!("{label}-home")),
        scratch_dir(&format!("{label}-target")),
        scratch_dir(&format!("{label}-bin")),
    );
    for (name, printed) in tools {
        let tool = bin.join(name);
        std::fs::write(&tool, format!("#!/bin/sh\necho '{printed}'\n")).unwrap();
        std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let sink = telemetry_test_sink::TelemetrySink::start();
    let mut output = None;
    // A script that was just written can be busy for a moment, and that reads as an unreadable version.
    for _ in 0..20 {
        let mut command = Command::new(env!("CARGO_BIN_EXE_konductor"));
        command
            .args(["doctor", "--json", "--no-version-check", "--target"])
            .arg(&target)
            .env("HOME", &home)
            .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
            .env_remove("NO_COLOR")
            .stdin(Stdio::null());
        for var in sink.env_vars() {
            command.env(var.name, var.value);
        }
        let run = command.output().expect("spawn konductor");
        if String::from_utf8_lossy(&run.stdout).contains("Text file busy") {
            std::thread::sleep(Duration::from_millis(50));
            continue;
        }
        output = Some(run);
        break;
    }
    let output = output.expect("doctor ran");
    let doc: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("doctor --json prints JSON");
    for dir in [home, target, bin] {
        std::fs::remove_dir_all(dir).ok();
    }
    (output, doc)
}

fn row<'a>(doc: &'a serde_json::Value, name: &str) -> &'a serde_json::Value {
    doc["runner_tools"]
        .as_array()
        .expect("runner_tools array")
        .iter()
        .find(|c| c["name"] == name)
        .unwrap_or_else(|| panic!("the {name} row"))
}

#[test]
fn the_claude_adapter_row_is_ok_in_range_a_warning_below_it_and_info_when_absent() {
    let (ok_run, doc) = doctor("claude-ok", &[("claude-agent-acp", "0.108.1")]);
    let found = row(&doc, "claude_agent_acp_version");
    assert_eq!(found["status"], "ok", "{doc}");
    assert!(found["summary"]
        .as_str()
        .unwrap()
        .contains("claude-agent-acp 0.108.1 is at or above the minimum 0.108.1"));

    let (run, doc) = doctor("claude-below", &[("claude-agent-acp", "0.107.9")]);
    let found = row(&doc, "claude_agent_acp_version");
    assert_eq!(found["status"], "warn", "{doc}");
    assert!(found["summary"]
        .as_str()
        .unwrap()
        .contains("below the minimum 0.108.1"));
    assert!(found["remediation"]
        .as_str()
        .unwrap()
        .contains("update claude-agent-acp"));
    assert_eq!(doc["warnings"], true);
    assert_eq!(run.status.code(), ok_run.status.code());

    let (_, doc) = doctor("claude-absent", &[]);
    let found = row(&doc, "claude_agent_acp_version");
    assert_eq!(found["status"], "info", "{doc}");
    assert!(found["summary"]
        .as_str()
        .unwrap()
        .contains("claude-agent-acp not found on PATH"));
}

#[test]
fn the_kiro_adapter_row_follows_the_version_of_kiro_cli_and_has_its_own_minimum() {
    let (ok_run, doc) = doctor("kiro-ok", &[("kiro-cli", "kiro-cli 3.5.0")]);
    assert_eq!(row(&doc, "kiro_cli_acp_version")["status"], "ok", "{doc}");
    assert_eq!(row(&doc, "kiro_cli_version")["status"], "ok", "{doc}");

    // 3.4.0 is enough for `kiro-cli chat` and below the range of `kiro-cli acp`.
    let (run, doc) = doctor("kiro-below", &[("kiro-cli", "kiro-cli 3.4.0")]);
    assert_eq!(row(&doc, "kiro_cli_version")["status"], "ok", "{doc}");
    let found = row(&doc, "kiro_cli_acp_version");
    assert_eq!(found["status"], "warn", "{doc}");
    assert!(found["summary"]
        .as_str()
        .unwrap()
        .contains("(for `kiro-cli acp`)"));
    assert!(found["summary"]
        .as_str()
        .unwrap()
        .contains("below the minimum 3.5.0"));
    assert_eq!(run.status.code(), ok_run.status.code());

    let (_, doc) = doctor("kiro-absent", &[]);
    assert_eq!(row(&doc, "kiro_cli_acp_version")["status"], "info", "{doc}");
}

#[test]
fn an_adapter_row_never_changes_the_exit_code_of_doctor() {
    let (clean, _) = doctor(
        "exit-clean",
        &[
            ("claude-agent-acp", "0.108.1"),
            ("kiro-cli", "kiro-cli 3.5.0"),
        ],
    );
    let (low, doc) = doctor(
        "exit-low",
        &[
            ("claude-agent-acp", "0.1.0"),
            ("kiro-cli", "kiro-cli 3.3.0"),
        ],
    );
    assert_eq!(row(&doc, "claude_agent_acp_version")["status"], "warn");
    assert_eq!(row(&doc, "kiro_cli_acp_version")["status"], "warn");
    assert_eq!(low.status.code(), clean.status.code());
    assert!(low.status.code().is_some_and(|c| c != 2));
}
