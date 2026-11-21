// SPDX-License-Identifier: Apache-2.0
//! Which runner harness a run may use. `flow run` calls this, and so will the canvas server of step 1g, so a server
//! started with `KONDUCTOR_FAKE_SCRIPT` set accepts `fake` and one started without it does not.
//!
//! The rule (spec: "Commands and exit codes"): `--harness` takes `kiro-cli`, `claude`, `kiro-cli-acp`, `claude-acp` or
//! `fake`. Without it the one runner harness that is installed is used, and with both or neither installed the flag is
//! required. The two ACP harnesses and `fake` are never a default: an installed adapter is not an installed runner
//! harness, and `fake` is for tests only. `flow view` does not exist yet. When it does it takes the first three only,
//! because the canvas lists no ACP harness ([`choose_view_harness`]). This module does not read the install index: the
//! caller says which runner harnesses are installed.

use std::ffi::OsStr;
use std::fmt;
use std::path::{Path, PathBuf};

/// The environment variable that names a fake script, in place of `--fake-script`.
pub const FAKE_SCRIPT_ENV: &str = "KONDUCTOR_FAKE_SCRIPT";

/// A harness that this build can run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HarnessChoice {
    /// The fake harness, with the script it replays.
    Fake { script: PathBuf },
    /// Headless Kiro CLI sessions.
    KiroCli,
    /// Headless Claude Code sessions.
    Claude,
    /// Kiro CLI through its ACP adapter, `kiro-cli acp`.
    KiroCliAcp,
    /// Claude Code through the ACP adapter `claude-agent-acp`.
    ClaudeAcp,
}

impl HarnessChoice {
    /// The value the run state records. The canvas contract's `Harness` values are `kiro-cli`, `claude` and `fake`, so
    /// a run on an ACP harness records a name that the contract does not list.
    pub fn name(&self) -> &'static str {
        match self {
            HarnessChoice::Fake { .. } => "fake",
            HarnessChoice::KiroCli => "kiro-cli",
            HarnessChoice::Claude => "claude",
            HarnessChoice::KiroCliAcp => "kiro-cli-acp",
            HarnessChoice::ClaudeAcp => "claude-acp",
        }
    }

    /// Whether the harness talks to an ACP adapter.
    pub fn is_acp(&self) -> bool {
        matches!(self, HarnessChoice::KiroCliAcp | HarnessChoice::ClaudeAcp)
    }
}

/// Which runner harnesses an install of Konductor has made: `kiro-cli-v2` and `kiro-v3` are `kiro-cli`, and `claude`
/// is `claude`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct InstalledRunners {
    pub kiro_cli: bool,
    pub claude: bool,
}

/// Why a harness is not accepted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HarnessRefusal {
    Unknown(String),
    /// No `--harness`, and both runner harnesses are installed.
    BothInstalled,
    /// No `--harness`, and neither runner harness is installed.
    NoneInstalled,
    /// `fake` with no script.
    FakeWithoutScript,
    /// An ACP harness, for a command that takes no ACP harness.
    NotForView(String),
}

impl fmt::Display for HarnessRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HarnessRefusal::BothInstalled => write!(
                f,
                "`--harness` is required: both `kiro-cli` and `claude` are installed, so Konductor cannot pick one. \
                 Pass `--harness kiro-cli` or `--harness claude`."
            ),
            HarnessRefusal::NoneInstalled => write!(
                f,
                "`--harness` is required: no `kiro-cli` or `claude` install is recorded in ~/.konductor/installs. \
                 Pass `--harness kiro-cli` or `--harness claude`, or run `konductor install`."
            ),
            HarnessRefusal::Unknown(name) => write!(
                f,
                "`{name}` is not a harness. `--harness` takes `kiro-cli`, `claude`, `kiro-cli-acp`, `claude-acp` or \
                 `fake`."
            ),
            HarnessRefusal::NotForView(name) => write!(
                f,
                "`{name}` is not a harness for this command. `--harness` takes `kiro-cli`, `claude` or `fake`."
            ),
            HarnessRefusal::FakeWithoutScript => write!(
                f,
                "The `fake` harness is for tests and needs a script: pass `--fake-script <path>` or set {FAKE_SCRIPT_ENV}."
            ),
        }
    }
}

/// Decides whether harness `name` is accepted. `fake` is accepted only with a script: `fake_script` (the
/// `--fake-script` flag) if given, else `env_script` (the value of [`FAKE_SCRIPT_ENV`]). An empty value counts as none.
pub fn choose_harness(
    name: &str,
    fake_script: Option<&Path>,
    env_script: Option<&OsStr>,
) -> Result<HarnessChoice, HarnessRefusal> {
    match name {
        "fake" => {
            let script = fake_script
                .filter(|p| !p.as_os_str().is_empty())
                .or_else(|| env_script.filter(|v| !v.is_empty()).map(Path::new))
                .ok_or(HarnessRefusal::FakeWithoutScript)?;
            Ok(HarnessChoice::Fake {
                script: script.to_path_buf(),
            })
        }
        "kiro-cli" => Ok(HarnessChoice::KiroCli),
        "claude" => Ok(HarnessChoice::Claude),
        "kiro-cli-acp" => Ok(HarnessChoice::KiroCliAcp),
        "claude-acp" => Ok(HarnessChoice::ClaudeAcp),
        _ => Err(HarnessRefusal::Unknown(name.to_string())),
    }
}

/// [`choose_harness`] for a future `flow view`, which runs nothing and will take no ACP harness: the canvas lists none.
/// No command calls this yet.
pub fn choose_view_harness(
    name: &str,
    fake_script: Option<&Path>,
    env_script: Option<&OsStr>,
) -> Result<HarnessChoice, HarnessRefusal> {
    match choose_harness(name, fake_script, env_script)? {
        choice if choice.is_acp() => Err(HarnessRefusal::NotForView(name.to_string())),
        choice => Ok(choice),
    }
}

/// [`choose_harness`] for a command that may leave `--harness` out: without a name, the one installed runner harness is
/// used, so `name` is taken from `installed`. With both or neither installed the name is required.
pub fn resolve_harness(
    name: Option<&str>,
    installed: InstalledRunners,
    fake_script: Option<&Path>,
    env_script: Option<&OsStr>,
) -> Result<HarnessChoice, HarnessRefusal> {
    let name = match (name, installed) {
        (Some(name), _) => name,
        (
            None,
            InstalledRunners {
                kiro_cli: true,
                claude: false,
            },
        ) => "kiro-cli",
        (
            None,
            InstalledRunners {
                kiro_cli: false,
                claude: true,
            },
        ) => "claude",
        (
            None,
            InstalledRunners {
                kiro_cli: true,
                claude: true,
            },
        ) => return Err(HarnessRefusal::BothInstalled),
        (
            None,
            InstalledRunners {
                kiro_cli: false,
                claude: false,
            },
        ) => return Err(HarnessRefusal::NoneInstalled),
    };
    choose_harness(name, fake_script, env_script)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_acp_names_are_accepted_and_recorded_under_their_own_names() {
        assert_eq!(
            choose_harness("kiro-cli-acp", None, None),
            Ok(HarnessChoice::KiroCliAcp)
        );
        assert_eq!(
            choose_harness("claude-acp", None, None),
            Ok(HarnessChoice::ClaudeAcp)
        );
        assert_eq!(HarnessChoice::KiroCliAcp.name(), "kiro-cli-acp");
        assert_eq!(HarnessChoice::ClaudeAcp.name(), "claude-acp");
        assert!(HarnessChoice::ClaudeAcp.is_acp() && HarnessChoice::KiroCliAcp.is_acp());
        assert!(!HarnessChoice::Claude.is_acp() && !HarnessChoice::KiroCli.is_acp());
    }

    #[test]
    fn an_acp_harness_is_never_chosen_without_its_name() {
        for kiro_cli in [false, true] {
            for claude in [false, true] {
                let installed = InstalledRunners { kiro_cli, claude };
                if let Ok(choice) = resolve_harness(None, installed, None, None) {
                    assert!(!choice.is_acp(), "{choice:?}");
                }
            }
        }
    }

    #[test]
    fn the_unknown_name_message_lists_every_accepted_value() {
        let text = HarnessRefusal::Unknown("x".to_string()).to_string();
        for name in ["kiro-cli", "claude", "kiro-cli-acp", "claude-acp", "fake"] {
            assert!(text.contains(&format!("`{name}`")), "{text}");
        }
    }

    #[test]
    fn the_view_command_takes_no_acp_harness_and_names_what_it_takes() {
        for name in ["kiro-cli-acp", "claude-acp"] {
            let refusal = choose_view_harness(name, None, None).unwrap_err();
            assert_eq!(refusal, HarnessRefusal::NotForView(name.to_string()));
            let text = refusal.to_string();
            assert!(
                text.contains(&format!("`{name}`"))
                    && text.contains("`kiro-cli`, `claude` or `fake`")
                    && !text.contains("-acp` or"),
                "{text}"
            );
        }
        assert_eq!(
            choose_view_harness("claude", None, None),
            Ok(HarnessChoice::Claude)
        );
        assert_eq!(
            choose_view_harness("kiro-cli", None, None),
            Ok(HarnessChoice::KiroCli)
        );
        assert_eq!(
            choose_view_harness("fake", None, None),
            Err(HarnessRefusal::FakeWithoutScript)
        );
    }
}
