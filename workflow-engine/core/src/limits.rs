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
