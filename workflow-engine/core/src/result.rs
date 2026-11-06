// SPDX-License-Identifier: Apache-2.0
//! The stage result: the `KONDUCTOR_RESULT` line at the end of a session's final message (spec: "Stage result").

use crate::json::{self, Json};
use crate::rules::path_problem;

/// What starts a result line.
pub const RESULT_PREFIX: &str = "KONDUCTOR_RESULT ";

/// Why a stage is `blocked`. The codes are the canvas contract's `StageReason` values. Later slices add
/// `OUTPUT_MISSING`, `OUTPUT_UNCHANGED` and `CHECK_FAILED`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    ResultMissing,
    ResultInvalid,
    ResultFailure,
    SessionFailed,
    Timeout,
}

impl Reason {
    pub const ALL: [Reason; 5] = [
        Reason::ResultMissing,
        Reason::ResultInvalid,
        Reason::ResultFailure,
        Reason::SessionFailed,
        Reason::Timeout,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Reason::ResultMissing => "RESULT_MISSING",
            Reason::ResultInvalid => "RESULT_INVALID",
            Reason::ResultFailure => "RESULT_FAILURE",
            Reason::SessionFailed => "SESSION_FAILED",
            Reason::Timeout => "TIMEOUT",
        }
    }

    pub fn from_code(code: &str) -> Option<Reason> {
        Reason::ALL.into_iter().find(|r| r.as_str() == code)
    }
}

/// A valid result that reports success. The outputs are what the agent says it wrote. They are not proof.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StageResult {
    pub outputs: Vec<String>,
}

/// Reads the result from a final message: the last line that starts with [`RESULT_PREFIX`], so an example quoted
/// earlier in the message does not count.
///
/// The rest of the line is one JSON object with `status` (`success` or `failure`) and `outputs` (a list of paths that
/// follow the path rules). Other keys are ignored. An object with a key twice is invalid. The shape is checked before
/// the status, so a malformed line that says `failure` is `RESULT_INVALID`.
pub fn parse_result(final_message: &str) -> Result<StageResult, Reason> {
    let line = final_message
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .rfind(|line| line.starts_with(RESULT_PREFIX))
        .ok_or(Reason::ResultMissing)?;
    let value = json::parse(&line[RESULT_PREFIX.len()..]).map_err(|_| Reason::ResultInvalid)?;
    if !matches!(value, Json::Object(_)) {
        return Err(Reason::ResultInvalid);
    }
    let status = value
        .get("status")
        .and_then(Json::as_str)
        .ok_or(Reason::ResultInvalid)?;
    let outputs = value
        .get("outputs")
        .and_then(Json::as_array)
        .ok_or(Reason::ResultInvalid)?
        .iter()
        .map(|item| match item.as_str() {
            Some(path) if path_problem(path).is_none() => Ok(path.to_string()),
            _ => Err(Reason::ResultInvalid),
        })
        .collect::<Result<Vec<_>, _>>()?;
    match status {
        "success" => Ok(StageResult { outputs }),
        "failure" => Err(Reason::ResultFailure),
        _ => Err(Reason::ResultInvalid),
    }
}
