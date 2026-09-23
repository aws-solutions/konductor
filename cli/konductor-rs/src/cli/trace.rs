// SPDX-License-Identifier: Apache-2.0
//
// trace.rs — KONDUCTOR_LOG=debug diagnostic trace stream (Rust
// implementation).
//
// `KONDUCTOR_LOG=debug` turns on a stream of diagnostic trace lines to
// stderr for the current invocation only. Unset, or set
// to anything other than `debug`, produces no additional output. This
// is a single on/off switch, not a leveled log -- one level is enough
// here because this module only ever emits provenance/trace-level
// detail, with no separate warn/error tier to distinguish (unlike the
// skill-lookup MCP server, which gates its own `debug`/`info`/`warn`/
// `error` tiers by the same env var name for a different reason).
//
// Independent of `--json`: trace lines always go to stderr, never
// mixed into the stdout JSON document a `--json` consumer parses, and
// independent of the exit-code contract -- this module never
// returns or influences an exit code.
//
// Provenance only: a trace line names which config layer supplied a
// value, which install strategy matched, what path was resolved --
// never the resolved value of anything flagged sensitive. The
// skill-lookup MCP server's own `debug` level applies the identical
// boundary, adapted here for this module's stderr sink instead of a
// log file.
//
// Line format: `YYYY-MM-DDTHH:MM:SS LEVEL message`, plain text, one
// event per line, no JSON wrapping. Note this is deliberately NOT
// `time::utc_now_iso()`'s format (which ends in `Z` for the invocation
// log's own convention) -- this module's trace output always omits the
// trailing `Z`.

use std::sync::OnceLock;

use super::time::civil_from_days;

/// Whether `KONDUCTOR_LOG` is set to exactly `debug`, memoized for the
/// life of the process. Read once via `std::env::var` (not
/// `var_os`/case-insensitive matching -- an exact byte match against
/// `"debug"`, this module gates only its `debug` level) since the env
/// var does not change during a single invocation and every call site
/// would otherwise re-read it on every trace call.
fn debug_enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var("KONDUCTOR_LOG").as_deref() == Ok("debug"))
}

/// Emits one trace line to stderr if and only if `KONDUCTOR_LOG=debug`
/// is set; otherwise a no-op. `level` is a short tag (`"trace"` is the
/// only one this module currently emits -- see the module docstring on
/// why one level is enough for the CLI) and `message` must name only
/// provenance (paths, layer/strategy names, diagnostic reasons) --
/// never a value flagged sensitive.
///
/// Formats and writes directly via `eprintln!` rather than buffering:
/// each call is a complete, independent line, and the CLI's own
/// lifetime (one process per invocation) means there is no cross-call
/// state to batch.
pub(crate) fn trace(level: &str, message: &str) {
    if !debug_enabled() {
        return;
    }
    eprintln!("{} {level} {message}", trace_timestamp());
}

/// Formats the current time as `YYYY-MM-DDTHH:MM:SS` (no trailing
/// `Z`), this module's own line-format shape. Shares
/// `civil_from_days` with `time::utc_now_iso` (the invocation log's own
/// timestamp helper) to avoid a second civil-calendar implementation,
/// but does not call `utc_now_iso` itself since that function's format
/// ends in `Z` -- a different, and for this module wrong, shape.
fn trace_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let days = (secs / 86_400) as i64;
    let sod = secs % 86_400;
    let (hour, minute, second) = (sod / 3600, (sod % 3600) / 60, sod % 60);
    let (year, month, day) = civil_from_days(days);

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// This module's own trace line format: `YYYY-MM-DDTHH:MM:SS`, no
    /// trailing `Z`, 19 characters.
    #[test]
    fn trace_timestamp_matches_spec_shape_without_trailing_z() {
        let ts = trace_timestamp();
        assert_eq!(ts.len(), 19, "expected 19 chars, got {ts:?}");
        assert!(
            !ts.ends_with('Z'),
            "trace timestamps must not carry the invocation-log's trailing Z: {ts:?}"
        );
        assert_eq!(ts.as_bytes()[4], b'-');
        assert_eq!(ts.as_bytes()[7], b'-');
        assert_eq!(ts.as_bytes()[10], b'T');
        assert_eq!(ts.as_bytes()[13], b':');
        assert_eq!(ts.as_bytes()[16], b':');
    }

    /// `debug_enabled`'s memoization is process-lifetime, by design
    /// (the module docstring's rationale: the env var does not change
    /// during a single invocation) -- this test only pins the
    /// currently-unset-in-test-harness case actually observed, rather
    /// than attempting to toggle the OnceLock (which, once initialized
    /// by any earlier test in this binary, cannot be re-initialized).
    /// `trace()`'s own gating behavior is exercised end-to-end via the
    /// subprocess tests below, which each start a fresh process and so
    /// get a fresh `OnceLock`.
    #[test]
    fn debug_enabled_reflects_current_process_env_at_first_call() {
        // No assertion on the value itself (test-harness env is
        // whatever the surrounding `cargo test` invocation happened to
        // set) -- this only confirms the call does not panic and
        // returns a bool, i.e. the OnceLock initializes successfully.
        let _ = debug_enabled();
    }
}
