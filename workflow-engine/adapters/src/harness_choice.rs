// SPDX-License-Identifier: Apache-2.0
//! Which runner harness a run may use. `flow run` calls this, and so will the canvas server of step 1g, so a server
//! started with `KONDUCTOR_FAKE_SCRIPT` set accepts `fake` and one started without it does not.
//!
//! The rule (spec: "Commands and exit codes"): `--harness` takes `kiro-cli`, `claude` or `fake`. Without it the one
//! runner harness that is installed is used, and with both or neither installed the flag is required. `fake` is for
//! tests only and is never a default. This module does not read the install index: the caller says which runner
//! harnesses are installed.

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
}

impl HarnessChoice {
    /// The value the run state records, one of the contract's `Harness` values.
    pub fn name(&self) -> &'static str {
        match self {
            HarnessChoice::Fake { .. } => "fake",
            HarnessChoice::KiroCli => "kiro-cli",
            HarnessChoice::Claude => "claude",
        }
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
                "`{name}` is not a harness. `--harness` takes `kiro-cli`, `claude` or `fake`."
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
        _ => Err(HarnessRefusal::Unknown(name.to_string())),
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
