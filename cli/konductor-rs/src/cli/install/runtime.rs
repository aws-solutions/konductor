// SPDX-License-Identifier: Apache-2.0
//
// install/runtime.rs — install-target runtime auto-detection (Rust
// implementation, task 3.2).
//
// ── Scope ────────────────────────────────────────────────────────────────
// Detects which agent runtime(s) are present under a target directory.
// Kiro CLI and Claude Code are the only two runtimes `konductor install`
// registers with (Codex is a synth-transform target only, not an
// install target). Detection
// itself does not select an `InstallStrategy` -- that selection is the
// registry's job (each strategy's own `matches()`), never a central
// match/if-else chain over detected runtimes.

use std::path::Path;

/// An agent runtime `konductor install` can detect and register with.
/// Only Kiro CLI and Claude Code are supported install/registration
/// targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Runtime {
    KiroCli,
    ClaudeCode,
}

impl Runtime {
    /// Marker directory name, relative to a target directory, whose
    /// presence indicates this runtime is already configured there.
    /// Mirrors the `~/.kiro/` / `~/.claude/` convention this codebase's
    /// own docs (README.md's Installation section) describe.
    fn marker_dir(self) -> &'static str {
        match self {
            Runtime::KiroCli => ".kiro",
            Runtime::ClaudeCode => ".claude",
        }
    }
}

impl std::fmt::Display for Runtime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Runtime::KiroCli => "kiro-cli",
            Runtime::ClaudeCode => "claude-code",
        };
        write!(f, "{value}")
    }
}

/// Every `Runtime` variant, for iteration during detection.
const ALL_RUNTIMES: &[Runtime] = &[Runtime::KiroCli, Runtime::ClaudeCode];

/// Which runtimes were detected under a target directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectionResult {
    pub detected: Vec<Runtime>,
}

impl DetectionResult {
    pub fn has(&self, runtime: Runtime) -> bool {
        self.detected.contains(&runtime)
    }
}

/// Detects which of `Runtime`'s known runtimes have a marker directory
/// present directly under `target_dir`. Detection is presence-only (a
/// marker directory exists) -- it does not inspect the directory's
/// contents.
pub fn detect_runtimes(target_dir: &Path) -> DetectionResult {
    let detected = ALL_RUNTIMES
        .iter()
        .copied()
        .filter(|runtime| target_dir.join(runtime.marker_dir()).is_dir())
        .collect();
    DetectionResult { detected }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-runtime-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn detects_kiro_cli() {
        let dir = scratch_dir("kiro-hit");
        fs::create_dir_all(dir.join(".kiro")).unwrap();
        let result = detect_runtimes(&dir);
        assert!(result.has(Runtime::KiroCli));
        assert!(!result.has(Runtime::ClaudeCode));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn detects_claude_code() {
        let dir = scratch_dir("claude-hit");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        let result = detect_runtimes(&dir);
        assert!(result.has(Runtime::ClaudeCode));
        assert!(!result.has(Runtime::KiroCli));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn misses_on_empty_target() {
        let dir = scratch_dir("miss");
        let result = detect_runtimes(&dir);
        assert!(result.detected.is_empty());
        assert!(!result.has(Runtime::KiroCli));
        assert!(!result.has(Runtime::ClaudeCode));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn detects_both() {
        let dir = scratch_dir("both-hit");
        fs::create_dir_all(dir.join(".kiro")).unwrap();
        fs::create_dir_all(dir.join(".claude")).unwrap();
        let result = detect_runtimes(&dir);
        assert!(result.has(Runtime::KiroCli));
        assert!(result.has(Runtime::ClaudeCode));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn display_returns_kebab_case_value() {
        assert_eq!(Runtime::KiroCli.to_string(), "kiro-cli");
        assert_eq!(Runtime::ClaudeCode.to_string(), "claude-code");
    }
}

/// Test fixture (see `tests/fixtures/runtime_display_cases.json`) so the
/// string-representation contract is pinned from one source of truth.
#[cfg(test)]
mod shared_fixture {
    use super::*;

    const SHARED_FIXTURE_JSON: &str =
        include_str!("../../../tests/fixtures/runtime_display_cases.json");

    #[test]
    fn shared_fixture_cases_match_display_output() {
        let doc: serde_json::Value =
            serde_json::from_str(SHARED_FIXTURE_JSON).expect("shared fixture must be valid JSON");
        let cases = doc["cases"]
            .as_array()
            .expect("fixture must have a 'cases' array");
        assert!(!cases.is_empty(), "fixture must declare at least one case");

        for case in cases {
            let variant = case["variant"].as_str().unwrap();
            let expected = case["expected"].as_str().unwrap();
            let runtime = match variant {
                "KiroCli" => Runtime::KiroCli,
                "ClaudeCode" => Runtime::ClaudeCode,
                other => panic!("[fixture:{other}] unknown Runtime variant"),
            };
            assert_eq!(
                runtime.to_string(),
                expected,
                "[fixture:{variant}] Display output mismatch"
            );
        }
    }
}
