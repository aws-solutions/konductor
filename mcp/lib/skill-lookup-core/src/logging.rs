// SPDX-License-Identifier: Apache-2.0
//
// logging.rs — persistent, leveled file logging for Konductor MCP
// servers, per docs/design/konductor-skill-lookup-design.md §4.9.
//
// Path: `~/.konductor/mcp/logs/mcp-YYYYMMDD.log` (date-based, one file
// per UTC calendar day, appended across sessions on the same day).
//
// Retention: files whose *filename* date is more than 7 days older than
// today (UTC) are deleted once at process startup (see `init`) — no
// external logrotate dependency.
//
// Format: one line per event, `YYYY-MM-DDTHH:MM:SS LEVEL message`, plain
// text, no JSON wrapping (per §4.9's explicit format preference — easy
// to grep).
//
// Level gating: `info`/`warn`/`error` are always logged; `debug` is
// logged only when `KONDUCTOR_LOG=debug` is set in the environment
// (checked fresh on every call, not cached, so tests — and a running
// process, via `reload_skills` — can toggle it without a restart).
//
// Design choice — hand-rolled, not `tracing`/`tracing-subscriber`: the
// design doc's own stated format is a single flat `TIMESTAMP LEVEL
// message` text line with no JSON wrapping and no span/target/
// thread-name metadata. `tracing-subscriber`'s built-in formatters all
// carry that extra structure by default and would need a fully custom
// `FormatEvent` implementation to strip it back down to the doc's exact
// shape — at which point most of the crate's value (its ecosystem of
// subscribers/layers) goes unused, for the cost of three new
// exact-pinned dependencies (`tracing`, `tracing-subscriber`,
// `tracing-appender`) in a workspace that currently pulls in none. This
// repo's own precedent points the same way: `cli/konductor-rs/src/cli/
// logging.rs` implements an analogous invocation log with plain
// `std::fs`/`OpenOptions`, no external logging crate. A ~150-line
// hand-rolled writer, reusing that same precedent, is simpler than
// reaching for a framework built for needs (structured spans, multiple
// sinks, a filtering DSL) this server doesn't have.
//
// Placed in this crate (not the consuming `skill-lookup-mcp` binary)
// for two reasons. First, and sufficient on its own: `ScanDiagnostic`
// (`model.rs`) needs to log its own events at specific levels, which is
// only possible without a core-crate-depends-on-binary cycle if the
// writer lives here. Second: the log filename this design specifies is
// generic (`mcp-*.log`, not `skill-lookup-mcp-*.log`), so IF a second
// MCP server is ever built on this same core crate, its file-writing/
// retention/line-format half (`log_file_only`, `log_file_only_lines`,
// `Level`, everything above `log` below) is already server-agnostic and
// ready to share as-is. `log`'s `eprintln!` convenience wrapper is the
// one exception: it hardcodes the `"skill-lookup-mcp: "` stderr prefix,
// because exactly one consumer exists today and there is no concrete
// second server to design a source-identifying parameter against yet
// (see `log`'s own doc comment) — that is a real, narrower scope than
// the file-writing half, not an oversight.

use std::collections::HashMap;
use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Directory mode: owner-only rwx. This log directory can carry skill
/// names/paths and diagnostic query parameters (never secrets, per this
/// module's own contract — see `log`/`log_file_only`'s doc comments) but
/// there is no reason to make it group/other-readable by default, and
/// `cli/konductor-rs/src/cli/logging.rs`'s own invocation log already
/// establishes 0700/0600 as this repo's convention for a Konductor log
/// directory under `~/.konductor/`.
///
/// The create-then-re-pin idiom below (`ensure_log_dir`,
/// `write_sanitized_at`) is a second, near-verbatim copy of that same
/// file's `log_invocation` — not merely the same convention, the same
/// ~15-line pattern. Unlike `civil_from_days` above, no third call site
/// in this repo centralizes it yet, so there's nothing existing this
/// duplicates *away from*; noted here so the next person touching either
/// copy sees the other.
const DIR_MODE: u32 = 0o700;
/// File mode: owner-only rw. See `DIR_MODE`'s doc comment.
const FILE_MODE: u32 = 0o600;

/// Name of the `.konductor` directory, matching the CLI's own constant
/// (`cli/konductor-rs/src/cli/config.rs::KONDUCTOR_DIR_NAME`) and this
/// server's own copy (`skill-lookup-mcp`'s `cli.rs::KONDUCTOR_DIR_NAME`).
/// Kept as an independent duplicate rather than a shared dependency —
/// this crate has no path dependency on `cli/konductor-rs` (a separate,
/// binary-only Cargo package), matching this crate's own established
/// duplication precedent (see `frontmatter.rs`'s module doc comment for
/// the same tradeoff over frontmatter parsing).
const KONDUCTOR_DIR_NAME: &str = ".konductor";

/// Subdirectory (under `~/.konductor/`) holding every Konductor MCP
/// server's persistent logs — shared, not per-server, matching the
/// generic `mcp-YYYYMMDD.log` filename below.
const LOG_SUBDIR_COMPONENTS: [&str; 2] = ["mcp", "logs"];

/// Files under the log directory older (by filename date) than this many
/// days are deleted at startup. See §4.9: "Files older than 7 days are
/// deleted at startup ... combined with the date-based naming, this
/// bounds disk usage to at most 7 days of logs."
const RETENTION_DAYS: i64 = 7;

/// Log severity, matching §4.9's four-level table.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Info,
    Warn,
    Error,
    Debug,
}

impl Level {
    /// Uppercase name as it appears in a log line, matching §4.9's
    /// format (`YYYY-MM-DDTHH:MM:SS LEVEL message`).
    fn as_str(self) -> &'static str {
        match self {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
            Level::Debug => "DEBUG",
        }
    }
}

impl fmt::Display for Level {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Whether `debug`-level events should be logged: `KONDUCTOR_LOG=debug`
/// (case-insensitive), per §4.9. Re-read on every call rather than
/// cached — this module's own tests exercise every value without
/// mutating the real process environment (see `debug_enabled_with`), and
/// a long-lived server process should see a change to this env var take
/// effect without needing a restart.
pub fn debug_enabled() -> bool {
    debug_enabled_with(std::env::var_os("KONDUCTOR_LOG"))
}

/// Pure core of `debug_enabled`, taking the env value directly rather
/// than reading the process environment — lets tests exercise every case
/// (unset, empty, "debug", other) without mutating `KONDUCTOR_LOG`
/// itself, which would be racy across Rust's parallel test threads.
fn debug_enabled_with(value: Option<std::ffi::OsString>) -> bool {
    value
        .and_then(|v| v.into_string().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("debug"))
}

/// Resolves `~/.konductor/mcp/logs/`, or `None` if `HOME` is unset or
/// empty — fails open, matching the CLI's own convention
/// (`cli/konductor-rs/src/cli/logging.rs::log_dir`): logging must never
/// be the reason this server fails to start or serve a request.
pub fn log_dir() -> Option<PathBuf> {
    log_dir_with_home(std::env::var_os("HOME"))
}

/// Pure core of `log_dir`, taking `home` directly. Tests call this with
/// `None`/a scratch value instead of mutating the real `HOME`, which
/// would be racy across Rust's parallel test threads.
fn log_dir_with_home(home: Option<std::ffi::OsString>) -> Option<PathBuf> {
    let home = home?;
    if home.is_empty() {
        return None;
    }
    let mut dir = PathBuf::from(home).join(KONDUCTOR_DIR_NAME);
    for component in LOG_SUBDIR_COMPONENTS {
        dir.push(component);
    }
    Some(dir)
}

/// (year, month, day, hour, minute, second) for the current instant,
/// UTC. Falls back to the Unix epoch if the system clock reads before it
/// (`duration_since` failure) — an obviously-wrong timestamp is still a
/// valid log line, never a panic.
fn utc_now() -> (i32, u32, u32, u32, u32, u32) {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    civil_datetime_from_unix_secs(secs)
}

/// Splits a Unix timestamp (seconds since the epoch, UTC) into calendar
/// date + time-of-day components, using Howard Hinnant's
/// `civil_from_days` algorithm
/// (http://howardhinnant.github.io/date_algorithms.html) for the date
/// half. Duplicated rather than shared: this crate has no dependency on
/// `cli/konductor-rs` (a separate, binary-only Cargo package) or on
/// `chrono`/`time`, matching this module's own top doc comment.
///
/// This specific duplication is against a known target, not a
/// hypothetical one: `cli/konductor-rs/src/cli/time.rs::civil_from_days`
/// is the identical algorithm, already deduplicated once inside that
/// crate (its own module doc comment: "shared with `install/
/// kiro_cli.rs`'s copy to avoid duplicating the algorithm"). It is not
/// reusable from here regardless of a Cargo dependency edge: it is
/// `pub(crate)`, and `konductor` (that crate's `Cargo.toml`) declares
/// only a `[[bin]]` target with no `[lib]` — there is nothing to import
/// even in principle without restructuring that crate into a lib+bin
/// split, which is out of scope for this change (a separate
/// CLI-logging-scoped task owns `cli/konductor-rs`). A genuinely shared,
/// dependency-free micro-crate both `cli::time` and this module could
/// depend on is the real fix, left as a follow-up.
fn civil_datetime_from_unix_secs(secs: u64) -> (i32, u32, u32, u32, u32, u32) {
    let days = (secs / 86_400) as i64;
    let time_of_day = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    let hour = (time_of_day / 3600) as u32;
    let minute = ((time_of_day % 3600) / 60) as u32;
    let second = (time_of_day % 60) as u32;
    (year, month, day, hour, minute, second)
}

/// Howard Hinnant's `civil_from_days`: days since 1970-01-01 -> (year,
/// month, day), proleptic Gregorian calendar. Correct for every `i64`
/// input; no leap-second handling (Unix time has none to handle).
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

/// Inverse of `civil_from_days`: (year, month, day) -> days since
/// 1970-01-01. Used by retention to compare a log filename's encoded
/// date against today, without going through Unix-seconds at all.
fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y as i64 - 1 } else { y as i64 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64; // [0, 399]
    let mp = (if m > 2 { m - 3 } else { m + 9 }) as u64;
    let doy = (153 * mp + 2) / 5 + d as u64 - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe as i64 - 719_468
}

/// Renders one log line's leading date+time, `YYYY-MM-DDTHH:MM:SS`,
/// matching §4.9's format exactly (no trailing `Z`, unlike
/// `cli/konductor-rs`'s own timestamp helper — this is a deliberate,
/// doc-specified difference, not an oversight).
fn format_timestamp(y: i32, mo: u32, d: u32, h: u32, mi: u32, s: u32) -> String {
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}")
}

/// This log file's name for a given calendar date: `mcp-YYYYMMDD.log`.
///
/// Deliberately generic, not `skill-lookup-mcp-YYYYMMDD.log` — matching
/// §4.9's own filename. Consequence: the per-line format itself
/// (`format_timestamp` + `Level` + message, no source/server field) has
/// no way to attribute a line to which server wrote it if a second MCP
/// server is ever built on this crate and shares this same file. Not
/// fixed now, for the same reason `log`'s hardcoded stderr prefix isn't
/// parameterized yet (see this module's top doc comment): exactly one
/// consumer exists today, so there's no real second server to design a
/// source-identifying field against — adding one speculatively risks
/// guessing wrong (a prefix token? a suffix? per-line or file-level?).
/// If a second consumer appears, this line format is what will need to
/// change alongside `log`'s prefix.
fn log_file_name(y: i32, mo: u32, d: u32) -> String {
    format!("mcp-{y:04}{mo:02}{d:02}.log")
}

/// Parses a `mcp-YYYYMMDD.log` filename back into (year, month, day).
/// `None` for anything that doesn't match exactly — retention only ever
/// touches files this module itself wrote, never an unrelated file a
/// human or another tool happened to drop in the same directory.
fn parse_log_file_date(file_name: &str) -> Option<(i32, u32, u32)> {
    let digits = file_name.strip_prefix("mcp-")?.strip_suffix(".log")?;
    if digits.len() != 8 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let y: i32 = digits[0..4].parse().ok()?;
    let m: u32 = digits[4..6].parse().ok()?;
    let d: u32 = digits[6..8].parse().ok()?;
    // Reject an out-of-range month/day (e.g. `mcp-20269999.log`) rather
    // than handing garbage into `days_from_civil`'s unchecked arithmetic
    // — a filename this module never wrote could otherwise compute a
    // wildly wrong day-count and either dodge retention forever or get
    // deleted despite never having been produced by `log_file_name`.
    // Coarse (month 1-12, day 1-31) rather than exact days-in-month: this
    // is purely a "could this filename have come from `log_file_name`"
    // sanity check, not a calendar validator, and `civil_from_days`
    // itself is already correct for every `i64` input.
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some((y, m, d))
}

/// Deletes every `mcp-YYYYMMDD.log` file in `dir` whose encoded date is
/// more than `RETENTION_DAYS` days before `today`. Fails open per-file:
/// a file that can't be removed (permissions, already gone) is skipped,
/// never propagated — retention is best-effort housekeeping, not a
/// correctness requirement. Non-matching entries (anything not named
/// `mcp-YYYYMMDD.log`) are left untouched.
///
/// **Accepted risk, not fixed here:** deleting a path another process
/// currently has open for append doesn't error on POSIX — that writer's
/// subsequent `write_all` still returns `Ok`, but the bytes land in an
/// orphaned inode discarded once it closes the handle. A single
/// well-behaved process can't race itself this way (`today` is
/// recomputed fresh immediately before every write, so the file it's
/// about to write is always 0 days old, never `> RETENTION_DAYS`); this
/// only matters for two concurrently-running MCP servers sharing one
/// `$HOME` under multi-day clock skew between them — an extreme,
/// unlikely precondition this best-effort housekeeping intentionally
/// does not add file-locking complexity to guard against.
fn run_retention(dir: &Path, today: (i32, u32, u32)) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let today_days = days_from_civil(today.0, today.1, today.2);
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        let Some((y, m, d)) = parse_log_file_date(file_name) else {
            continue;
        };
        let file_days = days_from_civil(y, m, d);
        if today_days - file_days > RETENTION_DAYS {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Per-(directory, calendar day) memo of the last day `run_retention`
/// actually ran, scoped to this process. Guards `ensure_log_dir` so
/// retention's full `fs::read_dir` sweep plus a
/// `parse_log_file_date`/`days_from_civil` call per entry runs at most
/// once per directory per day, not on every single log write —
/// `write_sanitized_at` calls `ensure_log_dir` on every write, including
/// every per-call `find_skills`/`get_skill` debug line, so without this
/// gate a busy debug-logging session re-scans the whole log directory on
/// every one of them.
///
/// Day-keyed, not a one-shot `std::sync::Once`: a long-lived server
/// process that crosses a UTC day boundary must still re-run retention
/// on the first write of the new day (per §4.9's day-based retention
/// contract) — a plain one-shot would run retention once at process
/// start and then silently never again for the rest of that process's
/// lifetime.
///
/// Keyed by directory, not a single global day: this module's own test
/// suite exercises many distinct scratch directories that happen to
/// share a fixed test date (e.g. `(2026, 3, 4)`), and a day-only cache
/// would make the second such directory's first `ensure_log_dir` call a
/// silent no-op purely because an unrelated directory already "used up"
/// that day.
static LAST_RETENTION_RUN: std::sync::Mutex<Option<HashMap<PathBuf, i64>>> =
    std::sync::Mutex::new(None);

/// Ensures `dir` exists (owner-only, mode 0700 — see `DIR_MODE`) and has
/// had retention applied for `today`. Returns `false` if the directory
/// could not even be created (permissions, read-only filesystem, ...) —
/// callers treat that as "logging is a no-op right now," never as an
/// error to propagate.
///
/// `DirBuilder::mode()` only governs newly-created path components; if
/// `dir` already existed (e.g. from before this restriction shipped)
/// with looser permissions, re-pin it explicitly afterward so upgrading
/// still tightens a pre-existing world/group-readable directory —
/// mirrors `cli/konductor-rs/src/cli/logging.rs::log_invocation`'s own
/// re-pin for the same reason.
///
/// Retention itself only actually runs once per (directory, day) — see
/// `LAST_RETENTION_RUN`'s doc comment.
fn ensure_log_dir(dir: &Path, today: (i32, u32, u32)) -> bool {
    if fs::DirBuilder::new()
        .recursive(true)
        .mode(DIR_MODE)
        .create(dir)
        .is_err()
    {
        return false;
    }
    let _ = fs::set_permissions(dir, fs::Permissions::from_mode(DIR_MODE));
    let today_days = days_from_civil(today.0, today.1, today.2);
    let mut cache = LAST_RETENTION_RUN.lock().unwrap_or_else(|e| e.into_inner());
    let already_ran_today =
        cache.get_or_insert_with(HashMap::new).get(dir).copied() == Some(today_days);
    if !already_ran_today {
        run_retention(dir, today);
        cache
            .get_or_insert_with(HashMap::new)
            .insert(dir.to_path_buf(), today_days);
    }
    true
}

/// Runs 7-day retention once against the real `~/.konductor/mcp/logs/`.
/// Call this exactly once, at process startup, before any other logging
/// in this process — see §4.9: "the server checks the log directory
/// before writing its first entry." A no-op (fails open) if `HOME` can't
/// be resolved.
///
/// Not required for `log`/`log_file_only` to work correctly on their
/// own — both also call `ensure_log_dir` themselves before writing, so a
/// caller that skips `init()` (e.g. a unit test building a `SkillIndex`
/// directly, bypassing `main`) still gets a working, retention-applied
/// log directory. Skipping `init()` only means retention runs lazily on
/// the first log write instead of unconditionally at startup — and,
/// either way, at most once per calendar day thereafter (see
/// `LAST_RETENTION_RUN`), not on every subsequent write.
pub fn init() {
    let (y, mo, d, ..) = utc_now();
    if let Some(dir) = log_dir() {
        ensure_log_dir(&dir, (y, mo, d));
    }
}

/// Cap on a single logged message's length, applied by `sanitize_message`.
/// Bounds how much a single caller-influenced event (e.g. an error
/// `Display` string this crate doesn't control the content of) can grow
/// one line of a file kept for up to `RETENTION_DAYS` days.
const MAX_MESSAGE_CHARS: usize = 4000;

/// Escapes every control character in `message` (not just `\n`/`\r`) and
/// truncates it to `MAX_MESSAGE_CHARS` chars, appending a
/// `...(truncated)` marker when it does. This is the mechanical half of
/// the "no secrets/tokens/file contents/env values" contract documented
/// on `log`/`log_file_only` below: callers still must not pass that
/// content in the first place (this function has no way to detect a
/// secret by inspection), but a stray control character — from a
/// caller-supplied argument (e.g. `get_skill`'s `name`) or from a
/// downstream library error's `Display` text this crate doesn't control
/// — must never reach the log file or the stderr mirror in `log`
/// unescaped. A bare `\n`/`\r` could let one event masquerade as several
/// well-formed `TIMESTAMP LEVEL message` lines, forging a fake entry in
/// a file whose whole purpose is to be a trustworthy record for a human
/// operator (see `model.rs`'s doc comment on `ScanDiagnostic`); other C0
/// control bytes and ANSI escape sequences (`\x1b[...`) could otherwise
/// spoof or overwrite terminal output when the line is `cat`'d or
/// printed live via `log`'s `eprintln!`. `char::is_control()` covers both
/// ranges, so any control character not explicitly named below renders
/// as a visible `\xNN` token instead of being acted on by a terminal.
/// Applied once, centrally, here — not left to each of this module's
/// many call sites to individually remember `{:?}` over `{}`.
fn sanitize_message(message: &str) -> String {
    let escaped: String = message
        .chars()
        .map(|c| match c {
            '\n' => "\\n".to_string(),
            '\r' => "\\r".to_string(),
            c if c.is_control() => format!("\\x{:02x}", c as u32),
            c => c.to_string(),
        })
        .collect();
    if escaped.chars().count() <= MAX_MESSAGE_CHARS {
        escaped
    } else {
        let truncated: String = escaped.chars().take(MAX_MESSAGE_CHARS).collect();
        format!("{truncated}...(truncated)")
    }
}

/// Core of `log_file_only`/`log_file_only_lines`, parameterized on the
/// log directory and "now" so tests can exercise real file writes and
/// retention against a scratch temp directory instead of the real
/// `~/.konductor/`.
///
/// `formatted_block` is written verbatim, byte-for-byte, in a single
/// `write_all` call (`write_all` against an `O_APPEND` file descriptor
/// is atomic per call — the reason `log_file_only_lines_at` builds one
/// fully-formatted multi-line block up front and writes it here in one
/// shot, instead of one `write_sanitized_at` call per line). Every line
/// inside it — including every line of a multi-line block — must
/// already carry its own `TIMESTAMP LEVEL ` prefix and trailing `\n`:
/// this function does not add or repeat a prefix itself, so a caller
/// that hands it an unprefixed continuation line produces a line with
/// no `LEVEL` token at all, silently undercounting a `grep LEVEL` over
/// the file. Callers are also responsible for having already run every
/// untrusted substring through `sanitize_message`; this function does
/// not re-sanitize.
fn write_sanitized_at(
    dir: &Path,
    level: Level,
    formatted_block: &str,
    now: (i32, u32, u32, u32, u32, u32),
) {
    if level == Level::Debug && !debug_enabled() {
        return;
    }
    let (y, mo, d, _h, _mi, _s) = now;
    if !ensure_log_dir(dir, (y, mo, d)) {
        return;
    }
    let path = dir.join(log_file_name(y, mo, d));
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .mode(FILE_MODE)
        .open(&path)
    {
        // `OpenOptions::mode()` only applies to a newly-created file;
        // re-pin explicitly in case today's file pre-existed with looser
        // permissions (e.g. from before this restriction shipped) —
        // mirrors the directory re-pin in `ensure_log_dir`.
        let _ = file.set_permissions(fs::Permissions::from_mode(FILE_MODE));
        let _ = file.write_all(formatted_block.as_bytes());
    }
}

/// Formats one already-sanitized message as a complete, single
/// `TIMESTAMP LEVEL message\n` line. The one place `format_timestamp`/
/// `Level::as_str` are combined with a message body, so every call site
/// that produces a log line — single or multi-line — goes through here
/// and always gets its own prefix.
fn format_line(
    level: Level,
    sanitized_message: &str,
    now: (i32, u32, u32, u32, u32, u32),
) -> String {
    let (y, mo, d, h, mi, s) = now;
    format!(
        "{} {} {sanitized_message}\n",
        format_timestamp(y, mo, d, h, mi, s),
        level.as_str()
    )
}

/// Core of `log_file_only`: sanitizes the single untrusted `message`,
/// formats it as one prefixed line, then delegates to `write_sanitized_at`.
fn log_file_only_at(dir: &Path, level: Level, message: &str, now: (i32, u32, u32, u32, u32, u32)) {
    let line = format_line(level, &sanitize_message(message), now);
    write_sanitized_at(dir, level, &line, now);
}

/// Core of `log_file_only_lines`: sanitizes each of `messages`
/// individually (so an embedded raw newline inside any one of them —
/// e.g. from a filesystem path containing `\n`, which the OS permits —
/// can never fake an extra line boundary), formats EACH ONE as its own
/// complete `TIMESTAMP LEVEL message\n` line via `format_line` (so a
/// batched write of N messages produces N independently-grep-able
/// lines, not one prefixed line followed by N-1 bare continuations),
/// concatenates the fully-formatted lines, and writes the whole block
/// as a single `write_sanitized_at` call — preserving the atomicity
/// this batching exists for. A no-op if `messages` is empty (nothing to
/// write).
fn log_file_only_lines_at(
    dir: &Path,
    level: Level,
    messages: &[String],
    now: (i32, u32, u32, u32, u32, u32),
) {
    if messages.is_empty() {
        return;
    }
    let block: String = messages
        .iter()
        .map(|m| format_line(level, &sanitize_message(m), now))
        .collect();
    write_sanitized_at(dir, level, &block, now);
}

/// Writes one line to today's log file, `~/.konductor/mcp/logs/
/// mcp-YYYYMMDD.log`. `Level::Debug` is a no-op unless `KONDUCTOR_LOG=
/// debug` is set (checked internally, so callers never need their own
/// `if debug_enabled() { ... }` guard around this call itself — though a
/// caller building an expensive `message` may still want to guard the
/// formatting work; see `debug_enabled()`). Fails open on any I/O error
/// (missing `HOME`, permissions, disk full, ...): a logging failure must
/// never surface as a tool error or change this server's behavior.
///
/// **Security (§4.9):** `message` must never contain secrets, tokens,
/// file contents, or environment variable values — only skill paths,
/// skill names, diagnostic reasons, and query parameters. This is a
/// caller contract this function cannot itself enforce; every call site
/// in this codebase is audited against it (see the CR description).
///
/// File-only: does not also print to stderr. Use `log` for a call site
/// that has no stderr channel of its own; this is used directly by
/// `ScanDiagnostic::emit_to_stderr`, which already has its own,
/// separately-tested `eprintln!` output and only needs the persistent
/// copy added alongside it — not a second, differently-formatted stderr
/// line for the same event.
pub fn log_file_only(level: Level, message: &str) {
    let Some(dir) = log_dir() else {
        return;
    };
    log_file_only_at(&dir, level, message, utc_now());
}

/// Writes several related messages as ONE line in today's log file
/// (each joined by a real `\n` within that single line's message
/// portion, after each has been individually sanitized — see
/// `log_file_only_lines_at`), instead of one `log_file_only` call per
/// message. For a caller like `ScanDiagnostic::emit_to_stderr` that
/// produces a whole block of related lines (e.g. every skip from one
/// scan) and wants them landing as a single indivisible write —
/// `write_all` against an `O_APPEND` file descriptor is atomic per call,
/// so this is what actually prevents an unrelated concurrent write (a
/// different tool call's debug line, or a second MCP server sharing this
/// log directory) from landing in the middle of what's meant to read as
/// one coherent report. A no-op if `messages` is empty.
pub fn log_file_only_lines(level: Level, messages: &[String]) {
    let Some(dir) = log_dir() else {
        return;
    };
    log_file_only_lines_at(&dir, level, messages, utc_now());
}

/// `log_file_only`, plus an `eprintln!` of the same line to stderr (in
/// this module's own format, `skill-lookup-mcp: LEVEL message`) — for
/// call sites with no pre-existing, separately-tested stderr output of
/// their own. See `log_file_only`'s doc comment for the one deliberate
/// exception (`ScanDiagnostic::emit_to_stderr`).
///
/// Unlike the rest of this module, the `"skill-lookup-mcp: "` prefix
/// here is NOT server-agnostic — it names this crate's one current
/// consumer outright. Left this way deliberately rather than adding a
/// `server: &str` parameter now: no second consumer exists yet to design
/// that parameter against, and a speculative one risks guessing the
/// wrong shape (a prefix string? an enum? does it belong on `log` alone,
/// or on `log_file_only` too?). If a second server does show up, this is
/// the one function in this module that will need to change.
pub fn log(level: Level, message: &str) {
    log_file_only(level, message);
    if level != Level::Debug || debug_enabled() {
        // Same escaping as the persisted line (see `sanitize_message`),
        // for the same reason: a caller-influenced `message` must not be
        // able to forge what looks like a second, independent stderr
        // line via an embedded newline.
        eprintln!(
            "skill-lookup-mcp: {} {}",
            level.as_str(),
            sanitize_message(message)
        );
    }
}

/// Logs each name in `excluded_names` at `debug`, per §4.9's debug row:
/// "Skills excluded by `--skill-name-filter` (name + filter pattern)".
/// `filter` is the whole configured `--skill-name-filter` value (not
/// whichever comma-separated sub-pattern happened to reject a given
/// name): a name is excluded when it matches *none* of the configured
/// patterns, so there is no single pattern responsible for excluding
/// it — the full filter string is what §4.9 means by "filter pattern"
/// here.
///
/// Shared by both callers that apply a name filter (`main` at startup,
/// `reload_skills` on reload) so the debug-row wording and the
/// early-return optimization below live in one place. Checks
/// `debug_enabled()` itself, up front, rather than relying solely on
/// `log`'s own internal guard: `log` still no-ops correctly if this
/// guard were removed, but checking here first skips building `filter`
/// via `as_deref` and every per-name `format!` call when debug logging
/// is off, exactly as `handlers::find_skills`/`get_skill` already do
/// for their own debug lines.
pub fn log_filter_exclusions(filter: &Option<String>, excluded_names: &[String]) {
    if excluded_names.is_empty() || !debug_enabled() {
        return;
    }
    let filter = filter.as_deref().unwrap_or("");
    for name in excluded_names {
        log(
            Level::Debug,
            &format!("--skill-name-filter excluded skill '{name}' (pattern: '{filter}')"),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skill-lookup-logging-test-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// RAII guard: points the real `HOME` at a fresh scratch dir for its
    /// lifetime (holding the crate-wide `crate::test_home_lock::HOME_ENV_LOCK`
    /// throughout -- shared with `telemetry.rs`'s own `HOME`-mutating tests
    /// so the two modules never observe each other's `HOME` value mid-test;
    /// see `crate::test_home_lock`'s own doc comment for the cross-module
    /// race this closes), restoring the original value and removing the
    /// scratch dir on drop.
    struct HomeGuard {
        _lock: std::sync::MutexGuard<'static, ()>,
        scratch: PathBuf,
        original_home: Option<std::ffi::OsString>,
    }

    impl HomeGuard {
        fn new(label: &str) -> Self {
            let lock = crate::test_home_lock::lock_home();
            let scratch = temp_dir(label);
            let original_home = std::env::var_os("HOME");
            std::env::set_var("HOME", &scratch);
            Self {
                _lock: lock,
                scratch,
                original_home,
            }
        }
    }

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            match &self.original_home {
                Some(home) => std::env::set_var("HOME", home),
                None => std::env::remove_var("HOME"),
            }
            let _ = fs::remove_dir_all(&self.scratch);
        }
    }

    /// Exercises the actual public API (`log_dir`, `init`,
    /// `log_file_only`, `log_file_only_lines`) against a real `HOME` —
    /// every other test in this module calls the `_with_home`/`_at`
    /// pure cores directly with an explicit path, specifically to avoid
    /// `HOME` mutation; this is the one test proving those cores are
    /// actually wired correctly to the public functions that read the
    /// real environment.
    #[test]
    fn public_api_writes_to_the_real_home_relative_log_path() {
        let home = HomeGuard::new("public-api");

        init();
        log_file_only(Level::Info, "solo message");
        log_file_only_lines(
            Level::Warn,
            &["batched one".to_string(), "batched two".to_string()],
        );

        let dir = log_dir().expect("HOME is set for this test");
        assert_eq!(dir, home.scratch.join(".konductor/mcp/logs"));

        // Read back whichever `mcp-*.log` file(s) exist in the directory
        // rather than reconstructing the filename from a second, independent
        // `utc_now()` call: the writes above already picked their own file
        // via their own internal `utc_now()` calls, and re-deriving "today"
        // here races a real UTC calendar-day boundary crossing between the
        // writes and this read — a rare but real flaky-failure window on a
        // test that intentionally exercises the real clock. Scanning the
        // directory sidesteps the race entirely: whichever day(s) the writes
        // landed on, this reads them all. Matches via `parse_log_file_date`
        // (the same "is this one of our files" check `run_retention` uses)
        // rather than a raw `starts_with`/`ends_with` pair, so this test
        // recognizes exactly the filenames this module itself would ever
        // write — nothing looser.
        let mut contents = String::new();
        for entry in fs::read_dir(&dir).expect("log dir exists after a successful write") {
            let entry = entry.expect("readable log-dir entry");
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if parse_log_file_date(&name).is_some() {
                contents.push_str(&fs::read_to_string(entry.path()).expect("readable log file"));
            }
        }
        assert!(contents.contains("INFO solo message"), "got: {contents}");
        // Each batched message gets its own WARN-prefixed line -- not
        // one prefixed line followed by a bare continuation.
        assert!(contents.contains("WARN batched one"), "got: {contents}");
        assert!(contents.contains("WARN batched two"), "got: {contents}");
        assert_eq!(
            contents.matches("WARN batched").count(),
            2,
            "both batched messages must be independently grep-able: got: {contents}"
        );
    }

    // ── debug_enabled_with ───────────────────────────────────────────

    #[test]
    fn debug_enabled_with_unset_is_false() {
        assert!(!debug_enabled_with(None));
    }

    #[test]
    fn debug_enabled_with_empty_is_false() {
        assert!(!debug_enabled_with(Some("".into())));
    }

    #[test]
    fn debug_enabled_with_other_value_is_false() {
        assert!(!debug_enabled_with(Some("info".into())));
    }

    #[test]
    fn debug_enabled_with_debug_is_true() {
        assert!(debug_enabled_with(Some("debug".into())));
    }

    #[test]
    fn debug_enabled_with_debug_is_case_insensitive() {
        assert!(debug_enabled_with(Some("DEBUG".into())));
        assert!(debug_enabled_with(Some("Debug".into())));
    }

    // ── log_dir_with_home ────────────────────────────────────────────

    #[test]
    fn log_dir_with_home_none_is_none() {
        assert_eq!(log_dir_with_home(None), None);
    }

    #[test]
    fn log_dir_with_home_empty_is_none() {
        assert_eq!(log_dir_with_home(Some("".into())), None);
    }

    #[test]
    fn log_dir_with_home_resolves_mcp_logs_path() {
        let dir = log_dir_with_home(Some("/home/example".into())).unwrap();
        assert_eq!(dir, PathBuf::from("/home/example/.konductor/mcp/logs"));
    }

    // ── civil_from_days / days_from_civil ────────────────────────────

    #[test]
    fn civil_from_days_matches_known_epoch_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(11_017), (2000, 3, 1));
    }

    #[test]
    fn days_from_civil_matches_known_epoch_dates() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
    }

    #[test]
    fn civil_from_days_and_days_from_civil_round_trip() {
        for z in [0_i64, 1, 30, 365, 366, 10_000, 20_000, -1, -365] {
            let (y, m, d) = civil_from_days(z);
            assert_eq!(days_from_civil(y, m, d), z, "round trip failed for day {z}");
        }
    }

    // ── format_timestamp / log_file_name ─────────────────────────────

    #[test]
    fn format_timestamp_matches_the_design_docs_exact_shape() {
        // §4.9: `YYYY-MM-DDTHH:MM:SS LEVEL message` — no trailing `Z`,
        // unlike cli/konductor-rs's own timestamp helper.
        let ts = format_timestamp(2026, 3, 4, 5, 6, 7);
        assert_eq!(ts, "2026-03-04T05:06:07");
        assert!(!ts.ends_with('Z'));
    }

    #[test]
    fn log_file_name_matches_the_design_docs_pattern() {
        assert_eq!(log_file_name(2026, 3, 4), "mcp-20260304.log");
    }

    // ── parse_log_file_date ───────────────────────────────────────────

    #[test]
    fn parse_log_file_date_accepts_the_documented_pattern() {
        assert_eq!(parse_log_file_date("mcp-20260304.log"), Some((2026, 3, 4)));
    }

    #[test]
    fn parse_log_file_date_rejects_unrelated_files() {
        for name in [
            "mcp.log",
            "mcp-2026030.log",
            "mcp-20260304.txt",
            "skill-lookup-mcp-20260304.log",
            "mcp-abcd0304.log",
            "readme.md",
        ] {
            assert_eq!(parse_log_file_date(name), None, "expected None for {name}");
        }
    }

    #[test]
    fn parse_log_file_date_rejects_out_of_range_month_or_day() {
        // A well-formed 8-digit block this module never actually wrote
        // (month/day outside their calendar range) must not reach
        // `days_from_civil`'s unchecked arithmetic.
        for name in ["mcp-20269999.log", "mcp-20261399.log", "mcp-20260100.log"] {
            assert_eq!(parse_log_file_date(name), None, "expected None for {name}");
        }
    }

    // ── run_retention ─────────────────────────────────────────────────

    #[test]
    fn run_retention_deletes_files_older_than_seven_days_and_keeps_the_rest() {
        let dir = temp_dir("retention");
        let today = (2026, 1, 20);
        // 8 days before today -> deleted.
        fs::write(dir.join("mcp-20260112.log"), "old").unwrap();
        // exactly 7 days before today -> kept (boundary: "more than 7").
        fs::write(dir.join("mcp-20260113.log"), "boundary").unwrap();
        // today -> kept.
        fs::write(dir.join("mcp-20260120.log"), "today").unwrap();
        // unrelated file -> untouched regardless of any embedded date.
        fs::write(dir.join("notes-20260101.txt"), "unrelated").unwrap();

        run_retention(&dir, today);

        assert!(!dir.join("mcp-20260112.log").exists());
        assert!(dir.join("mcp-20260113.log").exists());
        assert!(dir.join("mcp-20260120.log").exists());
        assert!(dir.join("notes-20260101.txt").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_retention_on_missing_dir_does_not_panic() {
        let dir = temp_dir("retention-missing").join("does-not-exist");
        run_retention(&dir, (2026, 1, 20));
    }

    // ── log_file_only_at ──────────────────────────────────────────────

    #[test]
    fn log_file_only_at_writes_one_correctly_formatted_line() {
        let dir = temp_dir("write-one-line");
        log_file_only_at(&dir, Level::Info, "scan complete", (2026, 3, 4, 5, 6, 7));
        let contents = fs::read_to_string(dir.join("mcp-20260304.log")).unwrap();
        assert_eq!(contents, "2026-03-04T05:06:07 INFO scan complete\n");
        let _ = fs::remove_dir_all(&dir);
    }

    // ── log_file_only_lines_at ────────────────────────────────────────

    #[test]
    fn log_file_only_lines_at_writes_each_line_with_its_own_timestamp_and_level() {
        let dir = temp_dir("lines-one-write");
        log_file_only_lines_at(
            &dir,
            Level::Warn,
            &["skip one".to_string(), "skip two".to_string()],
            (2026, 3, 4, 5, 6, 7),
        );
        let contents = fs::read_to_string(dir.join("mcp-20260304.log")).unwrap();
        // Both messages land in ONE atomic `write_all` call (the whole
        // point of batching), but each is its OWN complete, independently
        // grep-able `TIMESTAMP LEVEL message` line -- not one prefixed
        // line followed by a bare continuation with no LEVEL token.
        assert_eq!(
            contents,
            "2026-03-04T05:06:07 WARN skip one\n2026-03-04T05:06:07 WARN skip two\n"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_file_only_lines_at_batched_write_is_fully_grep_countable() {
        // Every message in a multi-line batched write must carry its own
        // independent `TIMESTAMP LEVEL` prefix: a `grep -c WARN` count
        // must equal the number of messages, not 1 (which is what a
        // shared single-prefix format would silently undercount to).
        let dir = temp_dir("lines-grep-countable");
        let messages: Vec<String> = (1..=4).map(|n| format!("skip {n}")).collect();
        log_file_only_lines_at(&dir, Level::Warn, &messages, (2026, 3, 4, 5, 6, 7));
        let contents = fs::read_to_string(dir.join("mcp-20260304.log")).unwrap();
        let warn_line_count = contents.lines().filter(|l| l.contains("WARN")).count();
        assert_eq!(
            warn_line_count,
            messages.len(),
            "every batched message must carry its own grep-able WARN prefix: {contents:?}"
        );
        // Every line, not just the first, must independently contain a
        // timestamp -- i.e. no bare continuation lines.
        assert!(
            contents.lines().all(|l| l.starts_with("2026-03-04T")),
            "every line in the batch must have its own timestamp prefix: {contents:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_file_only_lines_at_empty_slice_writes_nothing() {
        let dir = temp_dir("lines-empty");
        log_file_only_lines_at(&dir, Level::Warn, &[], (2026, 3, 4, 5, 6, 7));
        assert!(!dir.join("mcp-20260304.log").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_file_only_lines_at_escapes_a_raw_newline_inside_one_message() {
        // A single message containing an embedded raw `\n` (e.g. from a
        // crafted filesystem path) must not be able to fake an extra
        // line boundary inside the joined block.
        let dir = temp_dir("lines-embedded-newline");
        log_file_only_lines_at(
            &dir,
            Level::Warn,
            &["one\nfake-line".to_string(), "two".to_string()],
            (2026, 3, 4, 5, 6, 7),
        );
        let contents = fs::read_to_string(dir.join("mcp-20260304.log")).unwrap();
        // Two messages in, two prefixed lines out -- the embedded raw
        // newline inside the first message was escaped to a literal
        // `\n`, not honored as a line separator, so it never becomes a
        // third (unprefixed) line.
        assert_eq!(
            contents,
            "2026-03-04T05:06:07 WARN one\\nfake-line\n2026-03-04T05:06:07 WARN two\n"
        );
        assert_eq!(
            contents
                .lines()
                .filter(|l| l.starts_with("2026-03-04T"))
                .count(),
            2
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sanitize_message_escapes_ansi_and_other_control_characters() {
        // An ANSI CSI escape sequence (ESC = 0x1b) and a bare NUL/backspace
        // must render as visible `\xNN` tokens, not pass through and be
        // acted on when the line is `cat`'d or mirrored to a live
        // terminal by `log`'s `eprintln!`. Only the ESC byte itself is a
        // control character -- `[`, digits, and `m` are ordinary
        // printable characters and pass through unescaped.
        let input = "before\x1b[31mred\x1b[0m\x00\x08after";
        let sanitized = sanitize_message(input);
        assert_eq!(sanitized, "before\\x1b[31mred\\x1b[0m\\x00\\x08after");
    }

    #[test]
    fn sanitize_message_still_escapes_newline_and_carriage_return_as_before() {
        // `\n`/`\r` keep their original, more readable `\n`/`\r` escape
        // (not the generic `\xNN` form other control characters get) --
        // this is what `log_file_only_lines_at_escapes_a_raw_newline_
        // inside_one_message` above already depends on.
        assert_eq!(sanitize_message("a\nb\rc"), "a\\nb\\rc");
    }

    #[test]
    fn log_file_only_at_appends_multiple_lines_same_day() {
        let dir = temp_dir("append-same-day");
        log_file_only_at(&dir, Level::Info, "first", (2026, 3, 4, 5, 6, 7));
        log_file_only_at(&dir, Level::Warn, "second", (2026, 3, 4, 5, 6, 8));
        let contents = fs::read_to_string(dir.join("mcp-20260304.log")).unwrap();
        assert_eq!(
            contents,
            "2026-03-04T05:06:07 INFO first\n2026-03-04T05:06:08 WARN second\n"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn concurrent_writers_to_the_same_directory_lose_no_lines() {
        // `~/.konductor/mcp/logs/` is designed to be shared across
        // concurrently-running MCP server processes (see this module's
        // top doc comment); prove that many threads racing
        // `log_file_only_at` (each opening the file fresh with
        // `OpenOptions::append(true)`, per POSIX `O_APPEND`) against the
        // same directory never lose or corrupt a line.
        let dir = std::sync::Arc::new(temp_dir("concurrent-writers"));
        let threads = 8;
        let lines_per_thread = 50;
        let handles: Vec<_> = (0..threads)
            .map(|t| {
                let dir = dir.clone();
                std::thread::spawn(move || {
                    for i in 0..lines_per_thread {
                        log_file_only_at(
                            &dir,
                            Level::Info,
                            &format!("thread {t} line {i}"),
                            (2026, 3, 4, 5, 6, 7),
                        );
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }

        let contents = fs::read_to_string(dir.join("mcp-20260304.log")).unwrap();
        let lines: Vec<&str> = contents.lines().collect();
        assert_eq!(
            lines.len(),
            threads * lines_per_thread,
            "expected every writer's every line to survive, got {} lines",
            lines.len()
        );
        // Every line must be a complete, well-formed entry -- no
        // truncated/merged line from a torn concurrent write.
        for line in &lines {
            assert!(
                line.contains("INFO thread") && line.contains("line"),
                "malformed or merged line: {line}"
            );
        }
        let _ = fs::remove_dir_all(dir.as_path());
    }

    #[test]
    fn log_file_only_at_debug_is_a_noop_without_the_env_var() {
        // debug_enabled() reads the real process env; this test only
        // asserts the no-env-var-set default (this crate's test process
        // does not set KONDUCTOR_LOG), matching the doc's "not debug by
        // default" behavior without mutating the environment.
        if debug_enabled() {
            return;
        }
        let dir = temp_dir("debug-noop");
        log_file_only_at(
            &dir,
            Level::Debug,
            "should not appear",
            (2026, 3, 4, 5, 6, 7),
        );
        assert!(!dir.join("mcp-20260304.log").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_filter_exclusions_is_a_noop_with_no_excluded_names() {
        // An empty `excluded_names` short-circuits before `debug_enabled()`
        // is ever read, so this is safe regardless of the real environment
        // — nothing here writes anywhere to observe, this only proves it
        // doesn't panic.
        log_filter_exclusions(&Some("keep-*".to_string()), &[]);
    }

    #[test]
    fn log_filter_exclusions_is_a_noop_without_the_env_var() {
        // debug_enabled() reads the real process env; matches this file's
        // own established pattern (see
        // log_file_only_at_debug_is_a_noop_without_the_env_var) for testing
        // a debug-gated no-op without mutating KONDUCTOR_LOG. With debug
        // disabled, log_filter_exclusions returns before ever calling
        // log_dir(), so no HOME/dir setup is needed here either.
        if debug_enabled() {
            return;
        }
        log_filter_exclusions(
            &Some("keep-*".to_string()),
            &["dropped".to_string(), "also-dropped".to_string()],
        );
    }

    #[test]
    fn log_file_only_at_runs_retention_before_writing() {
        // §4.9: retention runs "before writing its first entry" -- prove
        // an old file present in the target dir is gone once a new entry
        // has been written on a later date.
        let dir = temp_dir("retention-on-write");
        fs::write(dir.join("mcp-20260101.log"), "old").unwrap();
        log_file_only_at(&dir, Level::Info, "new entry", (2026, 3, 4, 0, 0, 0));
        assert!(!dir.join("mcp-20260101.log").exists());
        assert!(dir.join("mcp-20260304.log").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    // ── ensure_log_dir ────────────────────────────────────────────────

    #[test]
    fn ensure_log_dir_creates_a_missing_directory() {
        let dir = temp_dir("ensure-missing").join("nested").join("logs");
        assert!(!dir.exists());
        assert!(ensure_log_dir(&dir, (2026, 1, 1)));
        assert!(dir.is_dir());
        let _ = fs::remove_dir_all(&dir);
    }

    /// The log directory and file must be private to the owner
    /// (0700 / 0600), not readable/writable by group or other — matching
    /// `cli/konductor-rs/src/cli/logging.rs`'s own convention for a
    /// Konductor log directory.
    #[test]
    fn ensure_log_dir_and_log_file_have_restrictive_permissions() {
        let dir = temp_dir("permissions");
        assert!(ensure_log_dir(&dir, (2026, 3, 4)));
        log_file_only_at(&dir, Level::Info, "probe", (2026, 3, 4, 0, 0, 0));

        let dir_mode = fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        let file_mode = fs::metadata(dir.join("mcp-20260304.log"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(
            dir_mode, 0o700,
            "log dir must be mode 0700, got {dir_mode:o}"
        );
        assert_eq!(
            file_mode, 0o600,
            "log file must be mode 0600, got {file_mode:o}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_log_dir_runs_retention_at_most_once_per_directory_per_day() {
        let dir = temp_dir("retention-cache");
        // First call for day 1 primes the (dir, day) cache.
        assert!(ensure_log_dir(&dir, (2026, 5, 1)));
        // An old file dropped in AFTER the cache was primed for day 1
        // must survive a second same-day call against the SAME
        // directory -- proving retention did not re-scan the directory
        // (the whole point of the cache).
        fs::write(dir.join("mcp-20260101.log"), "old").unwrap();
        assert!(ensure_log_dir(&dir, (2026, 5, 1)));
        assert!(
            dir.join("mcp-20260101.log").exists(),
            "retention must not re-run for the same (dir, day) pair"
        );
        // Crossing into a new day must invalidate the cache and re-run
        // retention immediately -- a long-lived process must not
        // silently stop retaining forever once cached once.
        assert!(ensure_log_dir(&dir, (2026, 5, 2)));
        assert!(
            !dir.join("mcp-20260101.log").exists(),
            "retention must re-run on a new calendar day"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_log_dir_retention_cache_is_scoped_per_directory() {
        // Two distinct directories sharing the same "today" must each
        // get their own retention pass -- the cache is keyed by
        // directory, not by day alone. This is also what lets this
        // test file's many other tests safely reuse the same fixed
        // dates (e.g. (2026, 3, 4)) across distinct temp dirs without
        // interfering with each other via this cache.
        let dir_a = temp_dir("retention-cache-scope-a");
        let dir_b = temp_dir("retention-cache-scope-b");
        assert!(ensure_log_dir(&dir_a, (2026, 5, 1)));
        fs::write(dir_b.join("mcp-20260101.log"), "old").unwrap();
        assert!(ensure_log_dir(&dir_b, (2026, 5, 1)));
        assert!(
            !dir_b.join("mcp-20260101.log").exists(),
            "a different directory's cache entry must not suppress this directory's own first-ever retention run"
        );
        let _ = fs::remove_dir_all(&dir_a);
        let _ = fs::remove_dir_all(&dir_b);
    }

    // ── Level::Display ────────────────────────────────────────────────

    #[test]
    fn level_display_matches_the_design_docs_uppercase_names() {
        assert_eq!(Level::Info.to_string(), "INFO");
        assert_eq!(Level::Warn.to_string(), "WARN");
        assert_eq!(Level::Error.to_string(), "ERROR");
        assert_eq!(Level::Debug.to_string(), "DEBUG");
    }
}
