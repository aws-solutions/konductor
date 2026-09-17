// SPDX-License-Identifier: Apache-2.0
//
// output.rs — shared colorized-output resolution and helpers for the
// Konductor CLI.
//
// This is the sole path for colorized output in this crate: call sites
// go through `ColorMode` and the helpers below instead of embedding raw
// ANSI escapes or calling `owo_colors` directly, so `--no-color`/
// `NO_COLOR`/TTY resolution stays in one place.
//
// Color is OFF if any of the following hold, checked in this order:
//   1. `--no-color` was passed.
//   2. `NO_COLOR` is set to a non-empty value (per https://no-color.org).
//   3. The relevant output stream (stdout or stderr) is not a TTY.
// Otherwise color is ON. `--json`/`--verbose` never participate: JSON
// output never calls into this module at all.
//
// `ColorMode` is resolved once in `cli.rs::run_inner` and threaded down
// as a plain value through the same call path `verbose`/`json` already
// use, rather than read fresh (or cached globally) at each call site.

use std::io::IsTerminal;

/// Wraps `text` to the detected terminal width, indenting every line
/// (including the first) by `hanging_indent`. `text` must be plain,
/// uncolored content -- wrap first, then colorize the whole result
/// (e.g. via `status::dim`), since wrapping already-colorized text
/// would count embedded ANSI codes against the wrap width.
pub(crate) fn wrap_indented(text: &str, hanging_indent: &str) -> String {
    wrap_indented_at_width(text, hanging_indent, textwrap::termwidth())
}

/// `wrap_indented`'s width-parameterized core, split out so a caller
/// -- including a test -- can wrap at an explicit width instead of
/// the ambient terminal width. `cargo test`'s harness captures output
/// at the Rust `print!` layer, not via OS-level redirection, so a
/// test run from a real terminal still sees that terminal's actual
/// width through `textwrap::termwidth()`; a wide enough terminal
/// wraps nothing at all.
fn wrap_indented_at_width(text: &str, hanging_indent: &str, width: usize) -> String {
    let options = textwrap::Options::new(width)
        .initial_indent(hanging_indent)
        .subsequent_indent(hanging_indent);
    textwrap::wrap(text, options).join("\n")
}

/// Whether colorized output is enabled for a given stream. Stdout and
/// stderr are tracked independently since a caller can redirect one
/// but not the other, and TTY-ness is a per-stream property.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ColorMode {
    stdout_enabled: bool,
    stderr_enabled: bool,
}

impl ColorMode {
    /// Resolves both streams' color state from the signals described
    /// in this module's header. Inputs are passed in explicitly
    /// (rather than read internally) so tests can exercise every
    /// combination without touching real process state.
    pub(crate) fn resolve(
        no_color_flag: bool,
        no_color_env: bool,
        stdout_is_tty: bool,
        stderr_is_tty: bool,
    ) -> Self {
        let force_off = no_color_flag || no_color_env;
        Self {
            stdout_enabled: !force_off && stdout_is_tty,
            stderr_enabled: !force_off && stderr_is_tty,
        }
    }

    /// Production entry point: resolves against the real `NO_COLOR` env
    /// var and real stdout/stderr TTY state.
    pub(crate) fn resolve_from_env(no_color_flag: bool) -> Self {
        let no_color_env = std::env::var_os("NO_COLOR").is_some_and(|v| !v.is_empty());
        Self::resolve(
            no_color_flag,
            no_color_env,
            std::io::stdout().is_terminal(),
            std::io::stderr().is_terminal(),
        )
    }

    /// Color unconditionally off on both streams. Used as the "color
    /// off" fixture across this crate's tests.
    #[allow(dead_code)]
    pub(crate) const fn disabled() -> Self {
        Self {
            stdout_enabled: false,
            stderr_enabled: false,
        }
    }

    pub(crate) fn stdout_enabled(self) -> bool {
        self.stdout_enabled
    }

    pub(crate) fn stderr_enabled(self) -> bool {
        self.stderr_enabled
    }
}

/// Status-line styling helpers used by `doctor.rs`'s report rendering.
/// Each returns `label` colored when `mode.stdout_enabled()`, or
/// unchanged otherwise.
///
/// These all gate on `mode.stdout_enabled()`, so they're only correct
/// for `println!` call sites. A stderr call site needing a colorized
/// status label must resolve `ColorMode::stderr_enabled()` itself
/// rather than reuse one of these -- gating a stderr line on stdout's
/// TTY state gets split-stream redirection wrong.
pub(crate) mod status {
    use super::ColorMode;
    use owo_colors::OwoColorize;

    /// `ok` — green.
    pub(crate) fn ok(mode: ColorMode, label: &str) -> String {
        if mode.stdout_enabled() {
            label.green().to_string()
        } else {
            label.to_string()
        }
    }

    /// `info` — blue.
    pub(crate) fn info(mode: ColorMode, label: &str) -> String {
        if mode.stdout_enabled() {
            label.blue().to_string()
        } else {
            label.to_string()
        }
    }

    /// `warn` — yellow.
    pub(crate) fn warn(mode: ColorMode, label: &str) -> String {
        if mode.stdout_enabled() {
            label.yellow().to_string()
        } else {
            label.to_string()
        }
    }

    /// `failed`/`stale` — red.
    pub(crate) fn error(mode: ColorMode, label: &str) -> String {
        if mode.stdout_enabled() {
            label.red().to_string()
        } else {
            label.to_string()
        }
    }

    /// Dimmed/gray, no semantic status of its own. Used for text that
    /// should read as secondary to a status label above it (e.g.
    /// `doctor --all`'s batch header, and `fix:`/`detail:` lines).
    pub(crate) fn dim(mode: ColorMode, label: &str) -> String {
        if mode.stdout_enabled() {
            label.dimmed().to_string()
        } else {
            label.to_string()
        }
    }
}

/// Colorizes the `konductor <command>: `/`konductor: ` error-prefix
/// convention for stderr output — red. The trailing message is left
/// unstyled; only the greppable prefix is colorized.
pub(crate) fn error_prefix(mode: ColorMode, prefix: &str) -> String {
    if mode.stderr_enabled() {
        use owo_colors::OwoColorize;
        prefix.red().to_string()
    } else {
        prefix.to_string()
    }
}

/// `error_prefix`'s stdout counterpart, gated on `stdout_enabled()`.
/// For a red failure prefix printed via `println!` rather than
/// `eprintln!` (e.g. `install --link-bin`'s failure line, printed
/// alongside its `Ok` arms' stdout output).
pub(crate) fn error_prefix_stdout(mode: ColorMode, prefix: &str) -> String {
    if mode.stdout_enabled() {
        use owo_colors::OwoColorize;
        prefix.red().to_string()
    } else {
        prefix.to_string()
    }
}

/// Colorizes the `konductor <command>: ` success-prefix convention for
/// stdout output — green. Mirrors `error_prefix`'s shape for the
/// success side of the same convention.
pub(crate) fn success_prefix(mode: ColorMode, prefix: &str) -> String {
    if mode.stdout_enabled() {
        use owo_colors::OwoColorize;
        prefix.green().to_string()
    } else {
        prefix.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_color_flag_disables_both_streams_even_when_tty() {
        let mode = ColorMode::resolve(true, false, true, true);
        assert!(!mode.stdout_enabled());
        assert!(!mode.stderr_enabled());
    }

    #[test]
    fn no_color_env_disables_both_streams_even_when_tty() {
        let mode = ColorMode::resolve(false, true, true, true);
        assert!(!mode.stdout_enabled());
        assert!(!mode.stderr_enabled());
    }

    #[test]
    fn non_tty_stdout_disables_stdout_only() {
        let mode = ColorMode::resolve(false, false, false, true);
        assert!(!mode.stdout_enabled());
        assert!(mode.stderr_enabled());
    }

    #[test]
    fn non_tty_stderr_disables_stderr_only() {
        let mode = ColorMode::resolve(false, false, true, false);
        assert!(mode.stdout_enabled());
        assert!(!mode.stderr_enabled());
    }

    #[test]
    fn tty_with_no_disabling_signal_enables_both_streams() {
        let mode = ColorMode::resolve(false, false, true, true);
        assert!(mode.stdout_enabled());
        assert!(mode.stderr_enabled());
    }

    #[test]
    fn disabled_constant_disables_both_streams() {
        let mode = ColorMode::disabled();
        assert!(!mode.stdout_enabled());
        assert!(!mode.stderr_enabled());
    }

    #[test]
    fn status_helpers_return_plain_text_when_disabled() {
        let mode = ColorMode::disabled();
        assert_eq!(status::ok(mode, "ok"), "ok");
        assert_eq!(status::info(mode, "info"), "info");
        assert_eq!(status::warn(mode, "warn"), "warn");
        assert_eq!(status::error(mode, "failed"), "failed");
        assert_eq!(status::dim(mode, "detail"), "detail");
    }

    #[test]
    fn status_helpers_wrap_text_in_ansi_codes_when_enabled() {
        let mode = ColorMode::resolve(false, false, true, true);
        assert_ne!(status::ok(mode, "ok"), "ok");
        assert_ne!(status::info(mode, "info"), "info");
        assert_ne!(status::warn(mode, "warn"), "warn");
        assert_ne!(status::error(mode, "failed"), "failed");
        assert_ne!(status::dim(mode, "detail"), "detail");
        // The plain label text must still be present inside the
        // styled string -- only ANSI codes are added around it, never
        // a wording change.
        assert!(status::ok(mode, "ok").contains("ok"));
        assert!(status::dim(mode, "detail").contains("detail"));
    }

    #[test]
    fn error_prefix_plain_when_disabled() {
        let mode = ColorMode::disabled();
        assert_eq!(
            error_prefix(mode, "konductor install:"),
            "konductor install:"
        );
    }

    #[test]
    fn error_prefix_styled_when_enabled_preserves_text() {
        let mode = ColorMode::resolve(false, false, true, true);
        let styled = error_prefix(mode, "konductor install:");
        assert_ne!(styled, "konductor install:");
        assert!(styled.contains("konductor install:"));
    }

    #[test]
    fn success_prefix_plain_when_disabled() {
        let mode = ColorMode::disabled();
        assert_eq!(
            success_prefix(mode, "konductor install:"),
            "konductor install:"
        );
    }

    #[test]
    fn success_prefix_styled_when_enabled_preserves_text() {
        let mode = ColorMode::resolve(false, false, true, true);
        let styled = success_prefix(mode, "konductor install:");
        assert_ne!(styled, "konductor install:");
        assert!(styled.contains("konductor install:"));
    }

    #[test]
    fn success_prefix_uses_stdout_enabled_not_stderr_enabled() {
        // Only-stderr-TTY must leave success_prefix plain.
        let mode = ColorMode::resolve(false, false, false, true);
        assert_eq!(
            success_prefix(mode, "konductor install:"),
            "konductor install:"
        );
    }

    #[test]
    fn error_prefix_stdout_plain_when_disabled() {
        let mode = ColorMode::disabled();
        assert_eq!(
            error_prefix_stdout(mode, "konductor install --link-bin:"),
            "konductor install --link-bin:"
        );
    }

    #[test]
    fn error_prefix_stdout_styled_when_enabled_preserves_text() {
        let mode = ColorMode::resolve(false, false, true, true);
        let styled = error_prefix_stdout(mode, "konductor install --link-bin:");
        assert_ne!(styled, "konductor install --link-bin:");
        assert!(styled.contains("konductor install --link-bin:"));
    }

    #[test]
    fn error_prefix_stdout_uses_stdout_enabled_not_stderr_enabled() {
        // Only-stderr-TTY leaves it plain; only-stdout-TTY still colors it.
        let stderr_only_tty = ColorMode::resolve(false, false, false, true);
        assert_eq!(
            error_prefix_stdout(stderr_only_tty, "konductor install --link-bin:"),
            "konductor install --link-bin:"
        );

        let stdout_only_tty = ColorMode::resolve(false, false, true, false);
        assert_ne!(
            error_prefix_stdout(stdout_only_tty, "konductor install --link-bin:"),
            "konductor install --link-bin:"
        );
    }

    #[test]
    fn wrap_indented_indents_even_a_single_unwrapped_line() {
        // hanging_indent applies to line 1 too, not just continuations.
        let wrapped = wrap_indented("short text", "    ");
        assert_eq!(wrapped, "    short text");
    }

    #[test]
    fn wrap_indented_wraps_long_text_with_hanging_indent_on_every_line() {
        // Width is explicit (not the ambient terminal) so this stays
        // deterministic regardless of what terminal the test runs in.
        let long_text = "word ".repeat(40); // long enough to wrap even at 80 columns.
        let wrapped = wrap_indented_at_width(long_text.trim_end(), "    ", 80);
        let lines: Vec<&str> = wrapped.split('\n').collect();
        assert!(
            lines.len() > 1,
            "text this long must wrap into multiple lines, got: {wrapped:?}"
        );
        for line in &lines {
            assert!(
                line.starts_with("    "),
                "every line (including the first) must start with the hanging indent, got: {line:?}"
            );
        }
    }

    #[test]
    fn wrap_indented_preserves_all_words_across_wrapped_lines() {
        // Width is explicit, and narrow enough to force multiple lines
        // regardless of the ambient terminal, so this actually
        // exercises reassembly across a wrap rather than passing
        // trivially on a single unwrapped line.
        let long_text = (1..=30)
            .map(|n| format!("word{n}"))
            .collect::<Vec<_>>()
            .join(" ");
        let wrapped = wrap_indented_at_width(&long_text, "    ", 20);
        let rejoined = wrapped
            .split('\n')
            .map(|line| line.trim_start())
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(
            rejoined, long_text,
            "wrapping must never drop or reorder words, only re-flow line breaks"
        );
    }

    #[test]
    fn wrap_indented_indents_even_empty_text() {
        let wrapped = wrap_indented("", "    ");
        assert_eq!(wrapped, "    ");
    }
}
