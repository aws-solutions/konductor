// SPDX-License-Identifier: Apache-2.0
//! Which runner harness a run may use. `flow run` calls this, and so will the canvas server of step 1g, so a server
//! started with `KONDUCTOR_FAKE_SCRIPT` set accepts `fake` and one started without it does not.

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
}

impl HarnessChoice {
    /// The value the run state records, one of the contract's `Harness` values.
    pub fn name(&self) -> &'static str {
        match self {
            HarnessChoice::Fake { .. } => "fake",
        }
    }
}

/// Why a harness is not accepted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HarnessRefusal {
    /// `kiro-cli` or `claude`, which a later step adds.
    NotInThisBuild(String),
    Unknown(String),
    /// `fake` with no script.
    FakeWithoutScript,
}

impl fmt::Display for HarnessRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HarnessRefusal::NotInThisBuild(name) => write!(
                f,
                "The `{name}` harness arrives in step 1f. This build runs only the `fake` harness, which is for tests."
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
        "kiro-cli" | "claude" => Err(HarnessRefusal::NotInThisBuild(name.to_string())),
        _ => Err(HarnessRefusal::Unknown(name.to_string())),
    }
}
