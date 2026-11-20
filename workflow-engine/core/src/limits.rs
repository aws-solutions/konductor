// SPDX-License-Identifier: Apache-2.0
//! The fixed limits of the first release (spec: "Rules for every file" and "Keys").

/// A file over this many bytes is treated as not there.
pub const MAX_FILE_BYTES: usize = 262_144;
/// YAML nested deeper than this many collections is `YAML_UNSUPPORTED`.
pub const MAX_YAML_DEPTH: usize = 32;
/// `intent.outcome` has 1 to this many characters (code points).
pub const MAX_OUTCOME_CHARS: usize = 300;
/// A workflow has at least this many stages.
pub const MIN_STAGES: usize = 1;
/// A workflow has at most this many stages.
pub const MAX_STAGES: usize = 40;
/// `prompt` and the text of `prompt_file` have 1 to this many characters (code points).
pub const MAX_PROMPT_CHARS: usize = 32_768;
/// The goal text of a run has at most this many characters (code points). A longer goal is a usage error.
pub const MAX_GOAL_CHARS: usize = 2048;
/// A param other than `goal` has at most this many bytes (64 KiB). A longer value is a usage error.
pub const MAX_PARAM_BYTES: usize = 65_536;
/// A rendered stage prompt, as the harness is given it, has at most this many bytes (100 KiB). A longer one is a usage
/// error.
pub const MAX_PROMPT_BYTES: usize = 102_400;
/// A stage may run for this many milliseconds of wall-clock time (30 minutes).
pub const STAGE_TIME_LIMIT_MS: u64 = 30 * 60 * 1000;
/// The runner keeps this many bytes from the end of a session's stdout (1 MiB), because the result line is the last
/// line of the final message.
pub const MAX_SESSION_OUTPUT_BYTES: usize = 1_048_576;
