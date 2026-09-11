// SPDX-License-Identifier: Apache-2.0
//
// synth/path_safety.rs — shared output-path containment checks, used
// by every `HarnessTransformer` that writes an agent/skill/SOP/context
// name (or a skill's auxiliary file) into an output path it
// constructs itself.
//
// A security-relevant containment check that exists in two places is a
// check that can be fixed in one and left broken in the other. This
// module is the single shared source of truth for those checks --
// `reject_unsafe_name_segment` and its four thin wrappers
// (`reject_unsafe_agent_name`/`_skill_name`/`_sop_name`/
// `_context_name`), plus `reject_unsafe_auxiliary_relative_path` (see
// its own docstring) -- so `kiro_cli_v2.rs` and `claude.rs` both call
// into it rather than each carrying their own copy.

use std::collections::BTreeMap;
use std::path::{Component, Path};

use unicode_normalization::UnicodeNormalization;

use super::model::{CanonicalModel, SkillDef};

/// Rejects a `name` that isn't a plain path segment: empty, absolute,
/// containing a path separator, a `..`/`.` component, or an embedded
/// NUL byte. Backs every one of this module's thin per-content-type
/// wrappers below. A NUL byte truncates a C string at the OS/
/// filesystem-syscall layer on Unix, so a name embedding one could
/// otherwise pass every other check here yet behave like a shorter,
/// differently-shaped path once it reaches the kernel.
///
/// Deliberately NOT rejected here (evidence-checked): a `:`-containing
/// name (e.g. `C:evil`,
/// which Rust's own `Path::join`/`PathBuf::push` documents as replacing
/// the base path outright on Windows when the pushed segment "has a
/// prefix but no root" -- a real containment bypass, but Windows-only:
/// `Component::Prefix` and the drive-relative push behavior it triggers
/// do not exist on Unix, where `:` is an ordinary filename byte with no
/// special meaning), NTFS Alternate-Data-Stream syntax
/// (`filename:stream`), Windows reserved device names (`CON`, `NUL`,
/// `COM1`-`9`, `LPT1`-`9`), or Windows' trailing-`.`/trailing-space
/// filename normalization (`SKILL.md.` colliding with `SKILL.md`).
/// Checked directly against this package's own `Config` before deciding
/// not to fix these: `build-tools` declares `RustLang1x` (Linux
/// binaries) as the build-fleet toolchain, with a macOS-only branch in
/// `aim-and-make-build` for local developer builds -- no Windows target
/// is declared anywhere in this package. Both real targets (Linux CI,
/// macOS local dev) are Unix, so none of these four Windows-specific
/// vectors are reachable on either. Revisit if a Windows target is ever
/// added.
pub(crate) fn reject_unsafe_name_segment(name: &str) -> bool {
    name.is_empty()
        || Path::new(name).is_absolute()
        || name == ".."
        || name == "."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
}

/// Agent name reserved because it collides with the SOP-scope sidecar
/// file synth writes into the very same `agents/` output directory as
/// every per-agent file (`kiro_cli_v2::SOP_SCOPES_SIDECAR_FILE`,
/// currently `"_sop_scopes.json"`). On Kiro CLI, `write_agent_file`
/// joins `agent_name` with an appended `.json` extension into that
/// directory with no collision check of its own, so an agent literally
/// named `_sop_scopes` would write its own file exactly where the
/// sidecar itself is about to be (over)written a moment later
/// (`transform` calls `write_sop_scopes_sidecar` only after every
/// per-agent `write_agent_file` call has already run for that content
/// type), and then vanish silently on install: `list_agent_files`
/// excludes that exact filename from the agent files it copies, since
/// it must never be parsed or rewritten as one. Compared
/// case-insensitively, like `collides_with_skill_md` below, since a
/// case-differing variant (`_Sop_Scopes`) still lands on the identical
/// on-disk path on a case-insensitive filesystem (macOS APFS default --
/// a real local-dev target for this package; see
/// `reject_unsafe_name_segment`'s own doc comment for the
/// Windows-target analysis this mirrors). A dedicated test in this
/// module (`reserved_sop_scopes_agent_name_matches_sidecar_file_stem`)
/// asserts this constant plus `.json` equals `kiro_cli_v2::
/// SOP_SCOPES_SIDECAR_FILE` exactly, so the two literals cannot silently
/// drift apart.
///
/// Claude's transformer (`claude.rs`'s own `write_agent_file`) joins
/// `agent_name` with a `.md` extension instead, so an agent named
/// `_sop_scopes` there writes to a different filename than the `.json`
/// sidecar -- no real collision exists on that harness. This reservation
/// still applies to Claude via the same `reject_unsafe_agent_name` call,
/// but only to keep the reserved name disallowed consistently across
/// both harnesses; it is a precaution, not a fix for a Claude-side
/// clobber.
pub(crate) const RESERVED_SOP_SCOPES_AGENT_NAME: &str = "_sop_scopes";

/// Agent name reserved because it collides with the skill-scope sidecar
/// file synth writes into the very same `agents/` output directory as
/// every per-agent file (`kiro_cli_v2::SKILL_SCOPES_SIDECAR_FILE`,
/// currently `"_skill_scopes.json"`). Mirrors
/// `RESERVED_SOP_SCOPES_AGENT_NAME` above exactly -- same collision
/// mechanism (`write_agent_file` joins `agent_name` with an appended
/// `.json` extension into that directory with no collision check of
/// its own, and `transform` calls `write_skill_scopes_sidecar` only
/// after every per-agent `write_agent_file` call has already run for
/// that content type), same silent-vanish-on-install failure mode
/// (`list_agent_files` excludes this exact filename), and the same
/// case-insensitive comparison rationale (macOS APFS default). A
/// dedicated test in this module
/// (`reserved_skill_scopes_agent_name_matches_sidecar_file_stem`)
/// asserts this constant plus `.json` equals `kiro_cli_v2::
/// SKILL_SCOPES_SIDECAR_FILE` exactly, so the two literals cannot
/// silently drift apart.
pub(crate) const RESERVED_SKILL_SCOPES_AGENT_NAME: &str = "_skill_scopes";

/// Rejects an `agent_name` that isn't a plain path segment, or that is
/// reserved (see `RESERVED_SOP_SCOPES_AGENT_NAME`/`RESERVED_SKILL_
/// SCOPES_AGENT_NAME`). This is each `HarnessTransformer`'s own
/// containment check at the point of path construction --
/// `write_agent_file` joins `agent_name` directly into an output path,
/// and the parser's `validate_agent_name` cannot be relied on alone
/// since `ParsedAgentSpec` values can be constructed directly without
/// going through the parser.
pub(crate) fn reject_unsafe_agent_name(agent_name: &str) -> Result<(), String> {
    if reject_unsafe_name_segment(agent_name) {
        return Err(format!("unsafe agent name for output path: {agent_name:?}"));
    }
    if case_insensitive_fold_key(agent_name)
        == case_insensitive_fold_key(RESERVED_SOP_SCOPES_AGENT_NAME)
    {
        return Err(format!(
            "agent name {agent_name:?} is reserved -- it collides with the SOP-scope sidecar \
             file ({RESERVED_SOP_SCOPES_AGENT_NAME}.json) once written to the same output \
             directory; rename the agent"
        ));
    }
    if case_insensitive_fold_key(agent_name)
        == case_insensitive_fold_key(RESERVED_SKILL_SCOPES_AGENT_NAME)
    {
        return Err(format!(
            "agent name {agent_name:?} is reserved -- it collides with the skill-scope sidecar \
             file ({RESERVED_SKILL_SCOPES_AGENT_NAME}.json) once written to the same output \
             directory; rename the agent"
        ));
    }
    Ok(())
}

/// Rejects a `skill_name` that isn't a plain path segment. Same shape
/// as `reject_unsafe_agent_name`; kept as its own named wrapper so a
/// skill-specific error message names the skill.
pub(crate) fn reject_unsafe_skill_name(skill_name: &str) -> Result<(), String> {
    if reject_unsafe_name_segment(skill_name) {
        return Err(format!("unsafe skill name for output path: {skill_name:?}"));
    }
    Ok(())
}

/// Rejects a `sop_name` that isn't a plain path segment. See
/// `reject_unsafe_skill_name`'s docstring for why this isn't collapsed
/// into a single generic wrapper beyond the shared containment
/// predicate.
pub(crate) fn reject_unsafe_sop_name(sop_name: &str) -> Result<(), String> {
    if reject_unsafe_name_segment(sop_name) {
        return Err(format!("unsafe SOP name for output path: {sop_name:?}"));
    }
    Ok(())
}

/// Rejects a `context_name` that isn't a plain path segment. See
/// `reject_unsafe_skill_name`'s docstring for why this isn't collapsed
/// into a single generic wrapper beyond the shared containment
/// predicate.
pub(crate) fn reject_unsafe_context_name(context_name: &str) -> Result<(), String> {
    if reject_unsafe_name_segment(context_name) {
        return Err(format!(
            "unsafe context file name for output path: {context_name:?}"
        ));
    }
    Ok(())
}

/// Rejects an `AuxiliaryFile.relative_path` that could escape the
/// skill's output directory when joined onto it, or that would collide
/// with the generated `SKILL.md`: absolute, empty, containing a `..`
/// component in any segment, containing an embedded NUL byte in any
/// segment (checked per-segment, not per-component, since
/// `Path::components()` does not split on NUL), or resolving to
/// `SKILL.md` once leading `.` (`CurDir`) components are stripped and
/// compared case-insensitively (see `collides_with_skill_md` below).
/// `parse_canonical` already guarantees `relative_path` is
/// skill-directory-scoped via `Path::strip_prefix` and excludes
/// `SKILL.md`, but per each transformer's own security contract (see
/// `parse_canonical.rs`'s module docstring) a `HarnessTransformer` must
/// not trust that alone -- `AuxiliaryFile` values can be constructed
/// directly without going through the parser.
///
/// An exact `relative_path == Path::new("SKILL.md")` structural
/// comparison is not sufficient here: a leading `./` defeats it --
/// `Path::new("./SKILL.md")` has components
/// `[CurDir, Normal("SKILL.md")]` and is NOT equal to
/// `Path::new("SKILL.md")`'s single `[Normal("SKILL.md")]`, so
/// `./SKILL.md` would pass such a guard outright while still resolving
/// to the exact same on-disk file as `SKILL.md` once joined onto
/// `skill_dir`. A case-SENSITIVE comparison is also not sufficient: a
/// variant like `Skill.MD` would pass too, and would silently collide
/// with the real `SKILL.md` on any case-insensitive filesystem (macOS
/// APFS default, Windows NTFS -- both realistic install targets, per
/// this same codebase's own `#[cfg(unix)]`/`#[cfg(not(unix))]` split for
/// `set_executable`). `collides_with_skill_md` below strips leading
/// `CurDir` components and compares case-insensitively for exactly this
/// reason. Either bypass would let an `AuxiliaryFile` silently overwrite
/// the just-written `SKILL.md` with attacker/author-controlled content,
/// since `write_skill` writes `SKILL.md` first and then iterates
/// `auxiliary_files` -- a colliding entry always wins last.
pub(crate) fn reject_unsafe_auxiliary_relative_path(relative_path: &Path) -> Result<(), String> {
    let has_nul = match relative_path.to_str() {
        Some(s) => s.contains('\0'),
        // Not valid UTF-8: cannot contain a UTF-8-encoded NUL character,
        // but treat as unsafe defensively rather than assuming safe.
        None => true,
    };
    let is_unsafe = relative_path.as_os_str().is_empty()
        || relative_path.is_absolute()
        || relative_path
            .components()
            .any(|c| matches!(c, Component::ParentDir))
        || collides_with_skill_md(relative_path)
        || has_nul;
    if is_unsafe {
        return Err(format!(
            "unsafe auxiliary file path for output: {relative_path:?}"
        ));
    }
    Ok(())
}

/// Rejects a `CanonicalModel` containing two agents, skills, SOPs, or
/// context entries -- or two auxiliary files within one skill -- whose
/// names differ only by case. This is the transformer-layer counterpart
/// of `parse_canonical.rs`'s `assert_unique_names`/
/// `assert_unique_auxiliary_paths_case_insensitive`: those checks run
/// only when a model is built through `parse_canonical` itself, but a
/// `CanonicalModel` can be constructed directly, bypassing the parser
/// entirely -- the same bypass this module's own `reject_unsafe_*_name`
/// tests already exercise, and the same threat model
/// `parse_canonical.rs`'s module docstring calls out explicitly.
/// Without this check, such a model would pass straight through
/// `HarnessTransformer::transform` and silently overwrite (or
/// interleave, for a skill directory) one entity's output with
/// another's on a case-insensitive filesystem (macOS APFS default,
/// Windows NTFS) -- exactly the failure mode the parse-time check exists
/// to prevent, reachable one layer down. Called once, centrally, by
/// `dispatch_synth_with` before any transformer runs: every registered
/// transformer receives the same `model` value, so one check there
/// covers all of them without each transformer duplicating the same
/// call at the top of its own `transform`.
pub(crate) fn reject_case_insensitive_model_collisions(
    model: &CanonicalModel,
) -> Result<(), String> {
    reject_case_insensitive_name_collisions(
        model.agents.iter().map(|a| a.name.as_str()),
        "agents",
    )?;
    reject_case_insensitive_name_collisions(
        model.skills.iter().map(|s| s.name.as_str()),
        "skills",
    )?;
    reject_case_insensitive_name_collisions(
        model.sops.iter().map(|s| s.name.as_str()),
        "agent-sops",
    )?;
    reject_case_insensitive_name_collisions(
        model.context.iter().map(|c| c.name.as_str()),
        "context",
    )?;
    for skill in &model.skills {
        reject_case_insensitive_auxiliary_path_collisions(skill)?;
    }
    Ok(())
}

/// Case-insensitive uniqueness check over one flat namespace (agents,
/// skills, SOPs, or context), folding each name via
/// `case_insensitive_fold_key`. `collection` names the namespace in the
/// error message so a caller sees which of the four collections
/// collided.
fn reject_case_insensitive_name_collisions<'a>(
    names: impl Iterator<Item = &'a str>,
    collection: &str,
) -> Result<(), String> {
    let mut seen: BTreeMap<String, &str> = BTreeMap::new();
    for name in names {
        let folded = case_insensitive_fold_key(name);
        if let Some(existing) = seen.insert(folded, name) {
            return Err(format!(
                "name '{name}' collides case-insensitively with '{existing}' in {collection} -- \
                 both would resolve to the same on-disk path on a case-insensitive filesystem \
                 (macOS APFS default, Windows NTFS)"
            ));
        }
    }
    Ok(())
}

/// Case-insensitive uniqueness check over one skill's own
/// `auxiliary_files`, mirroring `parse_canonical.rs`'s
/// `assert_unique_auxiliary_paths_case_insensitive`.
fn reject_case_insensitive_auxiliary_path_collisions(skill: &SkillDef) -> Result<(), String> {
    let mut seen: BTreeMap<String, String> = BTreeMap::new();
    for aux in &skill.auxiliary_files {
        let folded = case_insensitive_fold_key(&aux.relative_path.to_string_lossy());
        let path_display = aux.relative_path.display().to_string();
        if let Some(existing) = seen.insert(folded, path_display.clone()) {
            return Err(format!(
                "skill '{}': auxiliary file '{path_display}' collides case-insensitively with \
                 '{existing}' -- both would resolve to the same on-disk path on a \
                 case-insensitive filesystem (macOS APFS default, Windows NTFS)",
                skill.name
            ));
        }
    }
    Ok(())
}

/// Case-insensitive collision fold key, shared by every case-folding
/// site in `synth`: this module's own
/// `reject_case_insensitive_name_collisions`/
/// `reject_case_insensitive_auxiliary_path_collisions` above, and
/// `parse_canonical.rs`'s parse-time equivalents
/// (`assert_unique_names`/`assert_unique_auxiliary_paths_case_insensitive`).
/// NFC-normalizes `s` before lowercasing it: `str::to_lowercase` alone
/// performs Unicode case-mapping but not canonical-form normalization,
/// so two differently-composed but visually-identical strings (e.g. an
/// NFC-precomposed vs. an NFD-decomposed form of the same accented
/// character) would otherwise fold to different byte sequences and
/// bypass every collision check that relies on this key. A single
/// shared function so all four call sites fold identically -- a fix
/// applied to only one would leave the others exploitable.
///
/// `.stream_safe()` runs ahead of NFC composition, not after, matching
/// UAX #15's specified order for the Stream-Safe Text Format: it is a
/// pre-normalization bounding pass, so applying it first caps how many
/// combining marks NFC's internal decomposition buffer ever accumulates
/// against one base character before composing, rather than letting a
/// pathological run of combining marks (a "Zalgo text"-style name)
/// accumulate unbounded first. On the pinned `unicode-normalization`
/// version this fold measures as linear either way, so no runtime timing
/// test can tell a correct fold apart from an accidentally reverted one;
/// `case_insensitive_fold_key_calls_stream_safe_before_nfc_in_source`
/// below guards the call order directly instead. Agent names are also
/// capped at `MAX_AGENT_NAME_CHARS` scalars by `parser.rs`'s
/// `validate_agent_name`, but this fold's other three call sites --
/// SOP names, context names, and auxiliary relative paths -- carry no
/// length cap of their own and rely only on OS filename/`PATH_MAX`
/// limits, so the `.stream_safe()` ordering is this fold's only
/// defense for those. This fold runs twice per agent name per synth
/// invocation (once in `parse_canonical.rs::assert_unique_names`,
/// again here via `dispatch_synth_with`'s centralized
/// `reject_case_insensitive_model_collisions` call), so an unguarded
/// NFC pass would be amplified rather than merely present once.
pub(crate) fn case_insensitive_fold_key(s: &str) -> String {
    s.stream_safe().nfc().collect::<String>().to_lowercase()
}

/// True iff `relative_path`, once every leading `.` (`CurDir`) component
/// is stripped, resolves to a bare, case-insensitive `SKILL.md` --
/// i.e. would land at exactly `<skill_dir>/SKILL.md` once joined onto
/// the skill's output directory. A path with more than one remaining
/// component after stripping `CurDir` (e.g. `subdir/SKILL.md`) is a
/// genuinely different file in a genuinely different location and does
/// NOT collide -- this check is deliberately narrow to the exact
/// top-level collision the doc comment above describes, not every path
/// that happens to end in a file named `SKILL.md` anywhere in the tree.
fn collides_with_skill_md(relative_path: &Path) -> bool {
    let normalized: Vec<Component> = relative_path
        .components()
        .filter(|c| !matches!(c, Component::CurDir))
        .collect();
    let [Component::Normal(only)] = normalized.as_slice() else {
        return false;
    };
    only.to_str()
        .map(|s| s.eq_ignore_ascii_case("SKILL.md"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_safe_relative_paths() {
        assert!(reject_unsafe_auxiliary_relative_path(Path::new("template.md")).is_ok());
        assert!(reject_unsafe_auxiliary_relative_path(Path::new("scripts/run.sh")).is_ok());
    }

    #[test]
    fn rejects_absolute_path() {
        assert!(reject_unsafe_auxiliary_relative_path(Path::new("/etc/passwd")).is_err());
    }

    #[test]
    fn rejects_empty_path() {
        assert!(reject_unsafe_auxiliary_relative_path(Path::new("")).is_err());
    }

    #[test]
    fn rejects_parent_dir_component() {
        assert!(reject_unsafe_auxiliary_relative_path(Path::new("../evil.sh")).is_err());
        assert!(reject_unsafe_auxiliary_relative_path(Path::new("sub/../../evil.sh")).is_err());
    }

    #[test]
    fn rejects_embedded_nul() {
        assert!(reject_unsafe_auxiliary_relative_path(Path::new("evil\0name.sh")).is_err());
    }

    #[test]
    fn rejects_bare_skill_md() {
        assert!(reject_unsafe_auxiliary_relative_path(Path::new("SKILL.md")).is_err());
    }

    /// Regression guard for the exact bypass this module's docstring
    /// describes: a plain `relative_path == Path::new("SKILL.md")`
    /// check would let both cases below pass outright, since neither is
    /// byte-equal to the bare `SKILL.md` literal;
    /// `collides_with_skill_md` must reject both.
    #[test]
    fn rejects_curdir_prefixed_skill_md_bypass() {
        assert!(
            reject_unsafe_auxiliary_relative_path(Path::new("./SKILL.md")).is_err(),
            "a leading './' must not bypass the SKILL.md collision guard"
        );
        assert!(
            reject_unsafe_auxiliary_relative_path(Path::new("././SKILL.md")).is_err(),
            "multiple leading './' components must not bypass the guard either"
        );
    }

    /// Regression guard for the second bypass: case variants must be
    /// rejected too, since they collide with the real `SKILL.md` on any
    /// case-insensitive filesystem (macOS APFS default, Windows NTFS).
    #[test]
    fn rejects_case_variant_skill_md_bypass() {
        assert!(reject_unsafe_auxiliary_relative_path(Path::new("skill.md")).is_err());
        assert!(reject_unsafe_auxiliary_relative_path(Path::new("Skill.MD")).is_err());
        assert!(reject_unsafe_auxiliary_relative_path(Path::new("SKILL.MD")).is_err());
    }

    /// A file named `SKILL.md` inside a real subdirectory is NOT a
    /// collision with the skill's own top-level `SKILL.md` -- it lands
    /// at a genuinely different path once joined onto `skill_dir`, so
    /// this must remain accepted.
    #[test]
    fn accepts_skill_md_inside_a_real_subdirectory() {
        assert!(reject_unsafe_auxiliary_relative_path(Path::new("subdir/SKILL.md")).is_ok());
    }

    // -- `case_insensitive_fold_key` (NFC normalization ahead of the
    // lowercase fold, shared by all four case-insensitive collision
    // sites). --

    /// Falsifies the pre-fix behavior first: an NFC-precomposed "é"
    /// (`\u{e9}`, one codepoint) and its NFD-decomposed equivalent
    /// ("e" plus a combining acute accent, `e\u{301}`, two codepoints)
    /// are visually and semantically identical text, but
    /// `str::to_lowercase` alone -- with no normalization step -- folds
    /// them to two DIFFERENT byte sequences (confirmed here before
    /// asserting the fix): the whole reason this function exists is
    /// that a naive `.to_lowercase()` fold misses this pair.
    #[test]
    fn to_lowercase_alone_does_not_fold_nfc_and_nfd_forms_to_the_same_key() {
        let nfc = "Caf\u{e9}";
        let nfd = "Cafe\u{301}";
        assert_ne!(
            nfc.to_lowercase(),
            nfd.to_lowercase(),
            "sanity check: a bare to_lowercase() fold must NOT already unify these -- \
             otherwise this test isn't exercising the gap case_insensitive_fold_key closes"
        );
    }

    /// The fix: `case_insensitive_fold_key` NFC-normalizes before
    /// lowercasing, so the same NFC/NFD pair above DOES fold to the same
    /// key.
    #[test]
    fn case_insensitive_fold_key_unifies_nfc_and_nfd_forms() {
        let nfc = "Caf\u{e9}";
        let nfd = "Cafe\u{301}";
        assert_eq!(
            case_insensitive_fold_key(nfc),
            case_insensitive_fold_key(nfd)
        );
    }

    /// Termination/determinism smoke test for a pathological combining-mark
    /// run ("Zalgo text"): proves the fold completes and stays deterministic
    /// rather than hanging or panicking. This does NOT by itself guard the
    /// `.stream_safe()`/`.nfc()` call order -- on the pinned
    /// `unicode-normalization` version both orderings measure as linear
    /// here, so a reverted order would pass this test unchanged. See
    /// `case_insensitive_fold_key_calls_stream_safe_before_nfc_in_source`
    /// below for the test that actually guards the ordering.
    #[test]
    fn case_insensitive_fold_key_handles_long_combining_mark_run_without_hanging() {
        let combining_acute = '\u{0301}';
        let zalgo: String = std::iter::once('e')
            .chain(std::iter::repeat_n(combining_acute, 5000))
            .collect();
        let folded = case_insensitive_fold_key(&zalgo);
        assert!(!folded.is_empty());
        assert_eq!(
            folded,
            case_insensitive_fold_key(&zalgo),
            "fold must remain deterministic for a pathological combining-mark run"
        );
    }

    /// Strips a `//` line comment (and everything after it on that line)
    /// from each line of `text`, joined back with `\n`. Used to keep the
    /// source-level regression guard below from being satisfied by a
    /// comment that merely describes the call order rather than by the
    /// executable code itself.
    fn strip_line_comments(text: &str) -> String {
        text.lines()
            .map(|line| line.split("//").next().unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Blanks the contents of every string literal in `text` -- both
    /// plain/byte `"..."` literals and raw/raw-byte literals
    /// (`r"..."`, `r#"..."#`, `br"..."`, `br#"..."#`, ... up to any
    /// `#`-count) -- while leaving all other source text, including the
    /// delimiters themselves, untouched. This closes the sibling bypass
    /// to the one `strip_line_comments` closes: a decoy is not limited
    /// to a `//` comment naming the correct call order next to wrong
    /// executable code. A bare string literal containing the same
    /// substring (e.g. `let _marker = "stream_safe().nfc()";`) satisfies
    /// a raw `fn_body.contains(...)` check just as well, without needing
    /// any `//` at all, and does so for code that never calls
    /// `.stream_safe()`.
    ///
    /// Raw strings need their own branch because a `"` inside one is NOT
    /// a terminator -- only a `"` immediately followed by exactly the
    /// same number of `#` as opened the literal is. A plain
    /// quote-tracking scan (as used for non-raw literals below) would
    /// treat the raw literal's own embedded `"` as a real closing quote,
    /// desynchronizing the rest of the scan: it would let the raw
    /// literal's trailing content leak through as if it were live code
    /// (satisfying a positive substring check the decoy names), then
    /// re-enter "in string" mode on the literal's actual closing
    /// delimiter and blank the genuinely executable code that follows
    /// (defeating a negative substring check too). Detecting the
    /// `(b)?r#*"` prefix and scanning forward for its matching `"#*`
    /// terminator avoids both failures.
    ///
    /// Escaped quotes (`\"`) inside a non-raw literal are tracked so a
    /// `\"` sequence does not prematurely end the literal and
    /// desynchronize the scan for the rest of the body (raw literals
    /// have no escape sequences at all, per Rust's grammar, so this
    /// tracking is skipped for them).
    fn strip_string_literals(text: &str) -> String {
        let chars: Vec<char> = text.chars().collect();
        let len = chars.len();
        let mut out = String::with_capacity(text.len());
        let mut i = 0;
        while i < len {
            if let Some(hashes) = raw_string_prefix_hash_count(&chars, i) {
                i = strip_one_raw_string_literal(&chars, i, hashes, &mut out);
                continue;
            }
            let c = chars[i];
            if c == '"' {
                out.push('"');
                i += 1;
                while i < len {
                    let cc = chars[i];
                    if cc == '\\' {
                        // Consume the escaped character too (e.g. `\"`,
                        // `\\`) so it can't flip the literal closed early.
                        i += 2;
                    } else if cc == '"' {
                        out.push('"');
                        i += 1;
                        break;
                    } else {
                        // Blank everything else inside the literal.
                        i += 1;
                    }
                }
            } else {
                out.push(c);
                i += 1;
            }
        }
        out
    }

    /// If `chars[start..]` opens a raw or raw-byte string literal --
    /// `r`, or `br`, followed by zero or more `#`, followed by `"` --
    /// returns the number of `#` between the `r` and the opening `"`.
    /// Returns `None` otherwise, in which case `chars[start]` is left for
    /// the caller to treat as ordinary text. This can only misfire on
    /// source that would not compile: adjacent to a `"`, `r`/`br` is
    /// reserved by Rust's grammar for exactly this literal prefix, so
    /// `chars` -- always real, already-compiling crate source read via
    /// `include_str!`, or a compiling scratch snippet in a test -- cannot
    /// contain an `r`/`br` immediately before a `#*"` run that isn't one.
    fn raw_string_prefix_hash_count(chars: &[char], start: usize) -> Option<usize> {
        let mut i = start;
        if chars.get(i) == Some(&'b') {
            i += 1;
        }
        if chars.get(i) != Some(&'r') {
            return None;
        }
        i += 1;
        let hash_start = i;
        while chars.get(i) == Some(&'#') {
            i += 1;
        }
        if chars.get(i) == Some(&'"') {
            Some(i - hash_start)
        } else {
            None
        }
    }

    /// Copies a raw/raw-byte string literal's prefix (`(b)?r#*"`) and
    /// terminator (`"#*`, with the same `#`-count as the prefix) into
    /// `out` unchanged, while blanking everything in between -- the
    /// literal's own content, which may itself contain unescaped `"`
    /// characters that are not terminators. `start` must be the index a
    /// prior `raw_string_prefix_hash_count(chars, start) == Some(hashes)`
    /// call confirmed opens such a literal. Returns the index just past
    /// the terminator (or `chars.len()` if the literal runs off the end
    /// of `chars`, which cannot happen for compiling source).
    fn strip_one_raw_string_literal(
        chars: &[char],
        start: usize,
        hashes: usize,
        out: &mut String,
    ) -> usize {
        let len = chars.len();
        let mut i = start;
        if chars[i] == 'b' {
            out.push('b');
            i += 1;
        }
        out.push('r');
        i += 1;
        for _ in 0..hashes {
            out.push('#');
            i += 1;
        }
        out.push('"');
        i += 1;
        while i < len {
            // `i + 1 + hashes <= len` is required in addition to the
            // `.all(...)` check below: without it, a `#`-run that runs
            // off the end of `chars` shorter than `hashes` would still
            // pass `.iter().all(...)` vacuously (there's simply nothing
            // left to disagree with), falsely accepting a short match as
            // a full terminator.
            if chars[i] == '"'
                && i + 1 + hashes <= len
                && chars[i + 1..i + 1 + hashes].iter().all(|&c| c == '#')
            {
                out.push('"');
                for _ in 0..hashes {
                    out.push('#');
                }
                return i + 1 + hashes;
            }
            // Blank the literal's own content, terminator search aside.
            i += 1;
        }
        len
    }

    /// Removes every `/* ... */` block comment from `text`, including
    /// nested block comments (Rust block comments nest, unlike C's --
    /// `/* outer /* inner */ still outer */` is one comment, not two),
    /// while copying string and raw string literals through verbatim so
    /// an embedded `/*` or `*/` inside real string content is never
    /// misread as opening or closing a comment. This mirrors Rust's own
    /// lexer, which tokenizes a string literal as a single unit before
    /// it would ever look for a comment inside it -- e.g.
    /// `"/* not a comment */"` is ordinary, compiling string content.
    ///
    /// This closes the third sibling bypass to the ones
    /// `strip_line_comments` and `strip_string_literals` close: a decoy
    /// naming the correct call order is not limited to a `//` line
    /// comment or a bare string literal -- a `/* ... */` block comment
    /// serves exactly the same purpose and is not stripped by either of
    /// those two passes.
    ///
    /// Composed as its own pass, run before `strip_line_comments` and
    /// `strip_string_literals` (a block comment can itself contain
    /// `//`-shaped text or quote characters that would otherwise confuse
    /// those two simpler, single-construct passes), rather than folded
    /// into one unified tokenizer: this guard's stripping only needs to
    /// recognize Rust's few comment/literal forms well enough to defeat
    /// a decoy hidden inside one, not a full parse of the function body,
    /// and this crate has no `syn`/`proc_macro2` dependency to build a
    /// real tokenizer on top of. Add a new pass here, in this same
    /// modular style, if a future Rust syntax form needs stripping.
    fn strip_block_comments(text: &str) -> String {
        let chars: Vec<char> = text.chars().collect();
        let len = chars.len();
        let mut out = String::with_capacity(text.len());
        let mut i = 0;
        while i < len {
            if let Some(hashes) = raw_string_prefix_hash_count(&chars, i) {
                i = copy_raw_string_literal_verbatim(&chars, i, hashes, &mut out);
                continue;
            }
            if chars[i] == '"' {
                i = copy_plain_string_literal_verbatim(&chars, i, &mut out);
                continue;
            }
            if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
                i = skip_block_comment(&chars, i);
                continue;
            }
            out.push(chars[i]);
            i += 1;
        }
        out
    }

    /// Copies a raw/raw-byte string literal (prefix, content, and
    /// terminator) into `out` completely unchanged. Used by
    /// `strip_block_comments`, which must see past a literal without
    /// altering it -- the later `strip_string_literals` pass is what
    /// actually blanks its content. `start` must be an index a prior
    /// `raw_string_prefix_hash_count(chars, start) == Some(hashes)` call
    /// confirmed opens such a literal.
    fn copy_raw_string_literal_verbatim(
        chars: &[char],
        start: usize,
        hashes: usize,
        out: &mut String,
    ) -> usize {
        let len = chars.len();
        let mut i = start;
        if chars[i] == 'b' {
            out.push('b');
            i += 1;
        }
        out.push('r');
        i += 1;
        for _ in 0..hashes {
            out.push('#');
            i += 1;
        }
        out.push('"');
        i += 1;
        while i < len {
            if chars[i] == '"'
                && i + 1 + hashes <= len
                && chars[i + 1..i + 1 + hashes].iter().all(|&c| c == '#')
            {
                out.push('"');
                for _ in 0..hashes {
                    out.push('#');
                }
                return i + 1 + hashes;
            }
            out.push(chars[i]);
            i += 1;
        }
        len
    }

    /// Copies a plain (non-raw) `"..."` string literal into `out`
    /// completely unchanged, tracking escaped quotes (`\"`) so one does
    /// not prematurely end the literal. Used by `strip_block_comments`;
    /// see `copy_raw_string_literal_verbatim`'s doc comment for why this
    /// copies rather than blanks. `chars[start]` must be the literal's
    /// opening `"`.
    fn copy_plain_string_literal_verbatim(chars: &[char], start: usize, out: &mut String) -> usize {
        let len = chars.len();
        let mut i = start;
        out.push('"');
        i += 1;
        while i < len {
            let c = chars[i];
            out.push(c);
            if c == '\\' {
                if let Some(&next) = chars.get(i + 1) {
                    out.push(next);
                }
                i += 2;
            } else if c == '"' {
                i += 1;
                break;
            } else {
                i += 1;
            }
        }
        i
    }

    /// Skips forward from `chars[start]` (which must be the `/` of an
    /// opening `/*`) past a complete, correctly-nested block comment,
    /// returning the index just past its final closing `*/`. Depth
    /// tracking means `/* outer /* inner */ still outer */` is treated
    /// as one comment ending at the LAST `*/`, matching Rust's own
    /// nesting rule -- a naive first-`*/`-wins scan would stop at the
    /// inner comment's close and leave `still outer */` as live text.
    fn skip_block_comment(chars: &[char], start: usize) -> usize {
        let len = chars.len();
        let mut i = start + 2;
        let mut depth: usize = 1;
        while i < len && depth > 0 {
            if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
                depth += 1;
                i += 2;
            } else if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                depth -= 1;
                i += 2;
            } else {
                i += 1;
            }
        }
        i
    }

    /// Skips forward from `chars[start]` (which must be `'`) past a valid
    /// Rust char literal -- `'x'`, `'\n'`, `'"'`, `'\''`, or `'\u{...}'` --
    /// copying it verbatim into `out`, and returns the index just past its
    /// closing `'`. Returns `None` if `chars[start]` does not open a valid
    /// char literal, in which case the caller must NOT advance past it: a
    /// bare `'` also opens a lifetime (`'a`, `'static`), which has no
    /// closing quote at all, so the two are only distinguishable by this
    /// lookahead, not by the leading `'` alone.
    ///
    /// This closes the fifth sibling bypass to the ones `strip_line_comments`,
    /// `strip_string_literals`, and `strip_block_comments` close (and the one
    /// `strip_comments_and_literals` itself already closes for the
    /// `/*`-inside-`//` interaction): before this fix, a char literal holding
    /// an embedded double quote (`'"'`) presented a bare `"` to the scanner,
    /// which had no notion of "inside a char literal" and misread it as
    /// opening a real string literal -- blanking everything from that point
    /// to the next literal `"` as if it were string content. A decoy like
    /// `let _decoy = '"';` sitting next to a genuinely executable wrong-order
    /// call could hide that call from the guard this way, exactly as
    /// `strip_string_literals_removes_decoy_raw_string_but_keeps_executable_code`
    /// documents for the raw-string case above.
    ///
    /// Escape handling: a backslash consumes the following character as the
    /// escaped value (covers `\n`, `\t`, `\\`, `\'`, `\"`, and any other
    /// single-char escape) rather than trying to enumerate Rust's escape
    /// table, since only "does this close after one more character" matters
    /// here, not which escape it is. `\u{...}` is special-cased separately,
    /// since its closing `}` can be an arbitrary number of hex digits away.
    fn skip_char_literal(chars: &[char], start: usize, out: &mut String) -> Option<usize> {
        let len = chars.len();
        let mut i = start + 1;
        if i >= len {
            return None;
        }
        if chars[i] == '\\' {
            i += 1;
            if i >= len {
                return None;
            }
            let esc = chars[i];
            i += 1;
            if esc == 'u' && chars.get(i) == Some(&'{') {
                i += 1;
                while i < len && chars[i] != '}' {
                    i += 1;
                }
                if i < len {
                    i += 1; // consume the closing '}'
                }
            }
            if chars.get(i) == Some(&'\'') {
                for &ch in &chars[start..=i] {
                    out.push(ch);
                }
                return Some(i + 1);
            }
            None
        } else if chars.get(i + 1) == Some(&'\'') {
            out.push(chars[start]);
            out.push(chars[i]);
            out.push(chars[i + 1]);
            Some(i + 2)
        } else {
            // Not a char literal -- most likely a lifetime (`'a`,
            // `'static`). Leave `chars[start]` for the caller to push as an
            // ordinary character; do not consume anything.
            None
        }
    }

    /// Strips `//` line comments, `/* ... */` block comments (nesting-aware),
    /// and blanks the content of string/raw-string literals, all in a
    /// single left-to-right scan -- the actual guard uses this, not the
    /// three-pass `strip_string_literals(strip_line_comments(strip_block_comments(...)))`
    /// composition (kept above for its own regression coverage of each
    /// construct in isolation, and still exercised directly by
    /// `strip_line_comments_removes_decoy_comment_but_keeps_executable_code`,
    /// `strip_block_comments_removes_decoy_comment_but_keeps_executable_code`,
    /// and `strip_string_literals_removes_decoy_string_but_keeps_executable_code`
    /// above).
    ///
    /// Composing three independent passes over the SAME raw text has a
    /// fundamental limit no ordering choice avoids: each pass sees only
    /// character patterns, not what construct another pass would consider
    /// itself "inside." A `/*` sitting inside a genuine `//` line comment
    /// (e.g. `// decoy /*`) is not a real block-comment opener, but a
    /// block-comment pass run ahead of the line-comment pass has no way to
    /// know that -- it opens a "comment" there anyway and scans past the
    /// following newline for the next `*/`-shaped text, silently deleting
    /// whatever genuinely executable code (or line-comment text) happens to
    /// sit in between. Running line comments first instead would dodge that
    /// specific case but reopen the ORIGINAL problem this file's own
    /// composition order already documents: a real block comment containing
    /// `//`-shaped text would then have its interior misread as starting a
    /// line comment before the block-comment pass ever gets to see it.
    /// Neither ordering is correct, because the bug is the two-pass split
    /// itself, not which pass runs first.
    ///
    /// A single scan closes this because it only recognizes `/*` or `//` as
    /// real openers from a position where NEITHER a string, a raw string,
    /// a char literal, a line comment, nor a block comment is already open
    /// -- exactly how a real lexer works, and the only way to make "is this
    /// `/*` real" depend on the surrounding context rather than being
    /// decided by a pass that cannot see it. Char literals (`skip_char_literal`
    /// above) are checked from that same "nothing else open" position, for
    /// the same reason: a `"` embedded in `'"'` must never be read as
    /// opening a string.
    fn strip_comments_and_literals(text: &str) -> String {
        let chars: Vec<char> = text.chars().collect();
        let len = chars.len();
        let mut out = String::with_capacity(text.len());
        let mut i = 0;
        while i < len {
            if let Some(hashes) = raw_string_prefix_hash_count(&chars, i) {
                i = strip_one_raw_string_literal(&chars, i, hashes, &mut out);
                continue;
            }
            let c = chars[i];
            if c == '\'' {
                if let Some(next) = skip_char_literal(&chars, i, &mut out) {
                    i = next;
                    continue;
                }
                // Not a char literal (e.g. a lifetime like 'a or 'static) --
                // fall through, the bare apostrophe is pushed as an ordinary
                // character by the bottom of the loop.
            }
            if c == '"' {
                out.push('"');
                i += 1;
                while i < len {
                    let cc = chars[i];
                    if cc == '\\' {
                        i += 2;
                    } else if cc == '"' {
                        out.push('"');
                        i += 1;
                        break;
                    } else {
                        i += 1;
                    }
                }
                continue;
            }
            if c == '/' && chars.get(i + 1) == Some(&'/') {
                // Line comment: skip up to (not including) the next
                // newline. The skipped text is never re-examined for a
                // nested `/*`, `"`, etc. -- this is what stops an
                // embedded `/*` inside a `//` comment from ever reaching
                // the `/*`-detection branch below.
                while i < len && chars[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            if c == '/' && chars.get(i + 1) == Some(&'*') {
                i = skip_block_comment(&chars, i);
                continue;
            }
            out.push(c);
            i += 1;
        }
        out
    }

    /// The bug a three-pass composition cannot avoid, closed by scanning
    /// once: a `/*` embedded inside a genuine `//` line comment must not be
    /// treated as opening a real block comment. A block-comment pass run
    /// ahead of a line-comment pass has no way to know the `/*` belongs to
    /// a `//` comment -- it opens a "comment" there anyway, scans past the
    /// following newline, and deletes whatever genuinely executable code
    /// (here, a decoy wrong-order call) happens to sit before the next
    /// `*/`-shaped text, while code after that bogus close survives
    /// untouched even though it was never actually live. `strip_comments_and_literals`
    /// closes this because it only recognizes `//` and `/*` from a position
    /// where nothing else is already open, so it commits to "this is a line
    /// comment" as soon as it sees the leading `//` and never reconsiders
    /// the rest of that line for a `/*` at all.
    #[test]
    fn strip_comments_and_literals_does_not_let_a_line_comments_slash_star_open_a_block_comment() {
        let decoy = "// decoy /* \ns.nfc().stream_safe() */\ns.stream_safe().nfc()";
        let stripped = strip_comments_and_literals(decoy);
        assert_eq!(
            stripped, "\ns.nfc().stream_safe() */\ns.stream_safe().nfc()",
            "the '// decoy /* ' line comment must be stripped in full up to its own newline, and \
             nothing past that newline may be swallowed as if it were still part of the comment; \
             got: {stripped}"
        );
        assert!(
            stripped.contains("s.nfc().stream_safe()"),
            "the genuinely executable wrong-order line after the line comment must survive \
             unchanged, not be silently deleted as if it were comment content; got: {stripped}"
        );
    }

    /// Symmetry check for the fix above: a `//` embedded inside a genuine
    /// `/* ... */` block comment has no special meaning in Rust and must
    /// not end the comment early or otherwise disturb the scan.
    #[test]
    fn strip_comments_and_literals_does_not_let_a_block_comments_slash_slash_end_it_early() {
        let text = "/* see http://example.com for details */\ns.stream_safe().nfc()";
        let stripped = strip_comments_and_literals(text);
        assert_eq!(
            stripped, "\ns.stream_safe().nfc()",
            "a '//'-shaped sequence inside a block comment must not end it early or corrupt the \
             scan; got: {stripped}"
        );
    }

    /// A string literal containing `//` (e.g. a URL) is ordinary, compiling
    /// Rust content, not a line comment -- `strip_comments_and_literals`
    /// must recognize the opening `"` before it ever considers the `//`
    /// inside the string. A three-pass composition that runs line-comment
    /// stripping ahead of string stripping gets this wrong (a latent gap
    /// pre-dating this fix, closed here as a side effect of scanning once).
    #[test]
    fn strip_comments_and_literals_does_not_misfire_on_double_slash_inside_a_string_literal() {
        let text = "let _url = \"http://example.com\";\ns.stream_safe().nfc()";
        let stripped = strip_comments_and_literals(text);
        assert!(
            stripped.contains("s.stream_safe().nfc()"),
            "code after a string literal containing '//' must survive unchanged, not be treated \
             as commented out; got: {stripped}"
        );
    }

    /// Baseline decoy coverage for `strip_comments_and_literals` itself,
    /// mirroring the individual-pass tests above: a decoy naming the
    /// correct call order -- as a line comment, a block comment, a plain
    /// string, or a raw string -- sitting next to executable code that
    /// uses the WRONG order, must not satisfy a substring check once
    /// stripped, and the executable line's own (wrong) order must still be
    /// detected.
    #[test]
    fn strip_comments_and_literals_removes_every_decoy_kind_but_keeps_executable_code() {
        let cases = [
            "// s.stream_safe().nfc()\ns.nfc().stream_safe()",
            "/* s.stream_safe().nfc() */\ns.nfc().stream_safe()",
            "let _m = \"s.stream_safe().nfc()\";\ns.nfc().stream_safe()",
            "let _m = r#\"s.stream_safe().nfc()\"#;\ns.nfc().stream_safe()",
        ];
        for decoy in cases {
            let stripped = strip_comments_and_literals(decoy);
            assert!(
                !stripped.contains("s.stream_safe().nfc()"),
                "the decoy's claimed order must not survive stripping; decoy: {decoy:?}, \
                 got: {stripped}"
            );
            assert!(
                stripped.contains("s.nfc().stream_safe()"),
                "the executable (wrong-order) line must survive stripping unchanged; \
                 decoy: {decoy:?}, got: {stripped}"
            );
        }
    }

    /// A char literal holding an embedded double quote (`'"'`) presented a
    /// bare `"` to the pre-fix scanner, which had no notion of "inside a
    /// char literal" and misread it as opening a real string literal --
    /// blanking everything from that point to the next literal `"` as if
    /// it were string content. That swallowed span could hide a decoy
    /// naming the correct call order from ever being recognized and
    /// stripped, while the genuinely executable line right after the char
    /// literal survives untouched -- exactly the `'"'` decoy attack
    /// `skip_char_literal` closes. Asserting the whole text round-trips
    /// unchanged directly proves the embedded quote never opened a fake
    /// string: if it had, everything from that quote to EOF (there is no
    /// second literal `"` to close it) would have been blanked instead.
    #[test]
    fn strip_comments_and_literals_does_not_let_a_char_literal_containing_a_quote_open_a_string() {
        let text = "let _quote = '\"';\ns.nfc().stream_safe()";
        let stripped = strip_comments_and_literals(text);
        assert_eq!(
            stripped, text,
            "a char literal holding an embedded quote must be copied through verbatim, not \
             misread as opening a string literal that swallows the rest of the text; \
             got: {stripped}"
        );
    }

    /// A bare `'` also opens a lifetime (`'a`, `'static`), which has no
    /// closing quote at all. `skip_char_literal` must recognize that this
    /// is not a valid char literal and leave the apostrophe for the caller
    /// to push as an ordinary character, rather than either consuming the
    /// rest of the generic parameter list looking for a closing quote that
    /// will never arrive, or otherwise desyncing the scan.
    #[test]
    fn strip_comments_and_literals_treats_a_lifetime_apostrophe_as_an_ordinary_character() {
        let text = "fn foo<'a>(x: &'a str) -> &'a str { x }";
        let stripped = strip_comments_and_literals(text);
        assert_eq!(
            stripped, text,
            "a lifetime apostrophe ('a) must be pushed through as an ordinary character, not \
             misparsed as the start of an unterminated char literal; got: {stripped}"
        );
    }

    /// Escaped char literals (`'\n'`, `'\u{...}'`) must round-trip intact:
    /// `skip_char_literal`'s escape handling (a backslash consumes the
    /// following character, with `\u{...}` special-cased for its
    /// variable-length closing `}`) must land exactly on the closing `'`
    /// rather than stopping short or overshooting into the code that
    /// follows.
    #[test]
    fn strip_comments_and_literals_keeps_escaped_char_literals_intact() {
        let text = "let _nl = '\\n';\nlet _u = '\\u{1234}';\ns.nfc().stream_safe()";
        let stripped = strip_comments_and_literals(text);
        assert_eq!(
            stripped, text,
            "escaped char literals ('\\n', '\\u{{...}}') must round-trip unchanged, not desync \
             the scan or get misread as opening a string; got: {stripped}"
        );
    }

    /// Proves `strip_line_comments` actually closes the bypass it exists
    /// for: a decoy `//` comment naming the correct call order, sitting
    /// above executable code that uses the WRONG order, must not satisfy a
    /// substring check once comments are stripped -- and the executable
    /// line's own (wrong) order must still be detected.
    #[test]
    fn strip_line_comments_removes_decoy_comment_but_keeps_executable_code() {
        let decoy = "// stream_safe().nfc() -- decoy comment, real code differs\n\
                     s.nfc().collect::<String>().to_lowercase()";
        let stripped = strip_line_comments(decoy);
        assert!(
            !stripped.contains("stream_safe().nfc()"),
            "the decoy comment's claimed order must not survive stripping; got: {stripped}"
        );
        assert!(
            stripped.contains("nfc().collect"),
            "the executable line itself must survive stripping unchanged; got: {stripped}"
        );
    }

    /// Proves `strip_string_literals` closes the sibling bypass: a decoy
    /// STRING LITERAL (not a comment) naming the correct call order, sitting
    /// next to executable code that never calls `.stream_safe()` at all,
    /// must not satisfy a substring check once string contents are blanked
    /// -- and the executable code itself must survive unchanged.
    #[test]
    fn strip_string_literals_removes_decoy_string_but_keeps_executable_code() {
        let decoy = "let _marker = \"stream_safe().nfc()\";\n\
                     s.nfc().collect::<String>().to_lowercase()";
        let stripped = strip_string_literals(decoy);
        assert!(
            !stripped.contains("stream_safe().nfc()"),
            "the decoy string literal's claimed order must not survive stripping; got: {stripped}"
        );
        assert!(
            stripped.contains("nfc().collect"),
            "the executable line itself must survive stripping unchanged; got: {stripped}"
        );
    }

    /// An escaped quote inside a string literal must not desynchronize the
    /// scan and cause the rest of the body to be treated as still "inside"
    /// the literal (which would blank real executable code that follows).
    #[test]
    fn strip_string_literals_handles_escaped_quotes_without_desyncing() {
        let text = "let _s = \"a\\\"b\";\ns.stream_safe().nfc()";
        let stripped = strip_string_literals(text);
        assert!(
            stripped.contains("s.stream_safe().nfc()"),
            "code after a literal containing an escaped quote must survive unchanged; got: {stripped}"
        );
    }

    /// The raw-string bypass this fix closes: a decoy RAW STRING literal
    /// (`r#"..."#`) containing the correct call order, sitting next to
    /// executable code that never calls `.stream_safe()` at all, must not
    /// satisfy a substring check once the raw literal's content is blanked
    /// -- and the executable code after it must survive unchanged. Before
    /// this fix, the raw literal's own embedded `"` desynchronized the
    /// plain quote-tracking scan: it let the decoy's claimed order leak
    /// through as if it were executable code, then re-entered "in string"
    /// mode on the literal's real closing delimiter and blanked the
    /// genuinely executable (wrong-order) code that followed.
    #[test]
    fn strip_string_literals_removes_decoy_raw_string_but_keeps_executable_code() {
        let decoy = "let _decoy = r#\"trap\" s.stream_safe().nfc() \"#;\n\
                     s.nfc().stream_safe()";
        let stripped = strip_string_literals(decoy);
        assert!(
            !stripped.contains("s.stream_safe().nfc()"),
            "the decoy raw string literal's claimed order must not survive stripping; got: {stripped}"
        );
        assert_eq!(
            stripped, "let _decoy = r#\"\"#;\ns.nfc().stream_safe()",
            "the raw literal's delimiters must survive, its content must be blanked, and the \
             executable line after it must survive unchanged; got: {stripped}"
        );
    }

    /// Raw BYTE string literals (`br#"..."#`) use the same terminator
    /// grammar as raw string literals -- the `b` prefix must not bypass
    /// the fix above.
    #[test]
    fn strip_string_literals_removes_decoy_raw_byte_string_but_keeps_executable_code() {
        let decoy = "let _decoy = br#\"trap\" s.stream_safe().nfc() \"#;\n\
                     s.nfc().stream_safe()";
        let stripped = strip_string_literals(decoy);
        assert!(
            !stripped.contains("s.stream_safe().nfc()"),
            "the decoy raw byte string literal's claimed order must not survive stripping; got: {stripped}"
        );
        assert_eq!(stripped, "let _decoy = br#\"\"#;\ns.nfc().stream_safe()");
    }

    /// A raw string opened with more than one `#` must only terminate at a
    /// `"` followed by exactly that many `#` -- a `"` followed by fewer `#`
    /// than the opening count is still literal content, not a terminator.
    #[test]
    fn strip_string_literals_handles_raw_string_with_multiple_hashes() {
        let text = "let _s = r##\"a\"# b\"##;\ns.stream_safe().nfc()";
        let stripped = strip_string_literals(text);
        assert_eq!(
            stripped, "let _s = r##\"\"##;\ns.stream_safe().nfc()",
            "a lone '\"#' inside a `##`-delimited raw literal must not be treated as its \
             terminator; got: {stripped}"
        );
    }

    /// An ordinary occurrence of the letter `r` (never immediately
    /// followed by `#*\"`, which is the only sequence the raw-string
    /// prefix detector matches) must not be treated as opening a raw
    /// string literal.
    #[test]
    fn strip_string_literals_does_not_misfire_on_r_not_followed_by_a_quote() {
        let text = "let r = 1;\nlet result = r + 1;";
        let stripped = strip_string_literals(text);
        assert_eq!(
            stripped, text,
            "text with no string literals at all must survive unchanged; got: {stripped}"
        );
    }

    /// Proves `strip_block_comments` closes the third sibling bypass: a
    /// decoy `/* ... */` BLOCK comment naming the correct call order,
    /// sitting next to executable code that uses the WRONG order, must not
    /// satisfy a substring check once block comments are stripped -- and
    /// the executable line's own (wrong) order must still be detected.
    #[test]
    fn strip_block_comments_removes_decoy_comment_but_keeps_executable_code() {
        let decoy = "/* s.stream_safe().nfc() -- decoy comment, real code differs */\n\
                     s.nfc().collect::<String>().to_lowercase()";
        let stripped = strip_block_comments(decoy);
        assert!(
            !stripped.contains("stream_safe().nfc()"),
            "the decoy block comment's claimed order must not survive stripping; got: {stripped}"
        );
        assert!(
            stripped.contains("nfc().collect"),
            "the executable line itself must survive stripping unchanged; got: {stripped}"
        );
    }

    /// Rust block comments nest (unlike C's): `/* outer /* inner */ still
    /// outer */` is ONE comment ending at the LAST `*/`. A naive
    /// first-`*/`-wins scan would stop at the inner comment's close and
    /// leave `still outer */` behind as live text, corrupting the result.
    #[test]
    fn strip_block_comments_handles_nested_block_comments() {
        let text = "/* outer /* inner */ still outer */\ns.stream_safe().nfc()";
        let stripped = strip_block_comments(text);
        assert_eq!(
            stripped, "\ns.stream_safe().nfc()",
            "a nested block comment must be removed in its entirety, up to its outermost \
             closing '*/', with the executable line after it surviving unchanged; got: {stripped}"
        );
    }

    /// A string literal containing `/*`-shaped text is ordinary, compiling
    /// Rust content -- `"/* not a comment */"` is a string, not a comment --
    /// so `strip_block_comments` must copy it through verbatim rather than
    /// misreading its embedded `/*`/`*/` as a real comment boundary. Getting
    /// this wrong would consume the string's own closing quote and the
    /// genuinely executable code that follows it.
    #[test]
    fn strip_block_comments_does_not_misfire_on_slash_star_inside_a_string_literal() {
        let text = "let _s = \"/* not a comment */\";\ns.stream_safe().nfc()";
        let stripped = strip_block_comments(text);
        assert_eq!(
            stripped, text,
            "text whose only '/*'/'*/' occurrences are inside a string literal must survive \
             unchanged; got: {stripped}"
        );
    }

    /// Source-level regression guard for the fold's call order (see the doc
    /// comment above `case_insensitive_fold_key`): on the pinned
    /// `unicode-normalization` version, no runtime behavior test can
    /// distinguish a correct fold from an accidentally reverted one, since
    /// both orderings measure as linear. This inspects the function's own
    /// source text directly instead. Every textual occurrence of the
    /// function's signature is checked independently, not just the first --
    /// a `#[cfg(test)]`/`#[cfg(not(test))]` split (the same pattern this
    /// file already uses for `content_writers.rs`'s `set_executable` via
    /// `#[cfg(unix)]`/`#[cfg(not(unix))]`) could otherwise put a
    /// correctly-ordered body under `#[cfg(test)]` -- the definition
    /// `cargo test` compiles, and the one this guard would find first if it
    /// only checked one occurrence -- while a `#[cfg(not(test))]` body with
    /// the WRONG order ships in every real, non-test build. Checking only
    /// the first match cannot catch that: the guard would report success on
    /// exactly the code path that never actually runs in production.
    /// Each occurrence's body slice is bounded to just that one function
    /// (from its signature to its own next top-level closing brace), so it
    /// can never include this test's own source further down the file.
    /// `strip_comments_and_literals` -- a single left-to-right scan, not a
    /// composition of separate passes -- strips block comments, line
    /// comments, and string-literal contents from each body before
    /// matching, so no `/* ... */` block comment, `//` line comment, or
    /// bare string literal describing the call order can satisfy the check
    /// in place of the executable code it sits next to; see that function's
    /// own doc comment for why a single scan is used rather than sequential
    /// passes. The check itself is anchored to `s.stream_safe().nfc()` --
    /// the receiver (`s`, this function's own parameter) plus the method
    /// chain -- rather than a bare `stream_safe().nfc()` substring, so a
    /// decoy floating anywhere in the body (not actually chained off `s`)
    /// cannot satisfy it either.
    #[test]
    fn case_insensitive_fold_key_calls_stream_safe_before_nfc_in_source() {
        let source = include_str!("path_safety.rs");
        // Built from two separate literals (joined at compile time via
        // `concat!`) rather than one literal spelling out the full search
        // string contiguously: this test itself runs later in the file than
        // the real function, so writing the complete search string out as
        // one contiguous run of characters anywhere nearby -- in the
        // assignment itself, or even in a comment describing it -- would
        // self-match against that very spot, corrupting `occurrences` with
        // a bogus entry pointing at this test's own source.
        let signature = concat!("pub(crate) fn ", "case_insensitive_fold_key");
        let occurrences: Vec<usize> = source
            .match_indices(signature)
            .map(|(offset, _)| offset)
            .collect();
        assert!(
            !occurrences.is_empty(),
            "case_insensitive_fold_key function not found in source"
        );

        for fn_start in occurrences {
            let fn_end = source[fn_start..]
                .find("\n}")
                .map(|offset| fn_start + offset)
                .unwrap_or(source.len());
            let fn_body = strip_comments_and_literals(&source[fn_start..fn_end]);

            assert!(
                fn_body.contains("s.stream_safe().nfc()"),
                "case_insensitive_fold_key must call .stream_safe() before .nfc() directly on \
                 its `s` parameter, in executable code (comments and string literals are \
                 stripped before this check), in EVERY definition found in source -- a \
                 cfg-gated variant at byte offset {fn_start} failed this check; got: {fn_body}"
            );
            assert!(
                !fn_body.contains("s.nfc().stream_safe()"),
                "case_insensitive_fold_key must not call .nfc() before .stream_safe() on its \
                 `s` parameter, in executable code (comments and string literals are stripped \
                 before this check), in EVERY definition found in source -- a cfg-gated variant \
                 at byte offset {fn_start} failed this check; got: {fn_body}"
            );
        }
    }

    /// Integration-level proof that the fix actually reaches the
    /// collision check it backs: two agent names differing only by
    /// NFC-vs-NFD composition of the same accented character must be
    /// rejected as a case-insensitive collision, not accepted as two
    /// distinct names.
    #[test]
    fn rejects_nfc_nfd_name_collision_bypassing_parser() {
        let model = CanonicalModel {
            agents: vec![bare_agent("Caf\u{e9}"), bare_agent("Cafe\u{301}")],
            ..Default::default()
        };
        let err = reject_case_insensitive_model_collisions(&model).unwrap_err();
        assert!(err.contains("collides case-insensitively"), "got: {err}");
    }

    // -- Name-segment containment tests. --

    #[test]
    fn reject_unsafe_name_segment_rejects_traversal_and_accepts_plain_names() {
        assert!(reject_unsafe_name_segment("../../evil"));
        assert!(reject_unsafe_name_segment(".."));
        assert!(reject_unsafe_name_segment("."));
        assert!(reject_unsafe_name_segment("/etc/passwd"));
        assert!(reject_unsafe_name_segment(""));
        assert!(reject_unsafe_name_segment("evil\0name"));
        assert!(!reject_unsafe_name_segment("safe-name"));
    }

    #[test]
    fn reject_unsafe_agent_name_rejects_traversal_and_nul() {
        assert!(reject_unsafe_agent_name("../../evil").is_err());
        assert!(reject_unsafe_agent_name("evil\0name").is_err());
        assert!(reject_unsafe_agent_name("safe-agent-name").is_ok());
    }

    /// The exact collision this reservation exists to prevent: an agent
    /// literally named `_sop_scopes` would write its own file to the
    /// same output path the SOP-scope sidecar file writes to a moment
    /// later, silently clobbering the agent's file and then being
    /// excluded from the install-side copy pass.
    #[test]
    fn reject_unsafe_agent_name_rejects_reserved_sop_scopes_name() {
        assert!(reject_unsafe_agent_name("_sop_scopes").is_err());
    }

    /// Case-insensitive variants of the reserved name must be rejected
    /// too -- they resolve to the identical on-disk path once `.json` is
    /// appended, on a case-insensitive filesystem (macOS APFS default).
    #[test]
    fn reject_unsafe_agent_name_rejects_reserved_sop_scopes_name_case_variant() {
        assert!(reject_unsafe_agent_name("_Sop_Scopes").is_err());
    }

    /// A name that merely contains the reserved literal as a substring
    /// must remain accepted -- this reservation is deliberately narrow to
    /// the exact collision, not a broad substring ban.
    #[test]
    fn reject_unsafe_agent_name_accepts_name_that_merely_contains_reserved_sop_scopes_literal() {
        assert!(reject_unsafe_agent_name("my_sop_scopes_agent").is_ok());
    }

    /// The reserved literal here plus a `.json` suffix must equal
    /// `kiro_cli_v2::SOP_SCOPES_SIDECAR_FILE` exactly, so a future edit to
    /// either constant without the other is caught here rather than
    /// silently reopening the collision this module rejects.
    #[test]
    fn reserved_sop_scopes_agent_name_matches_sidecar_file_stem() {
        assert_eq!(
            format!("{RESERVED_SOP_SCOPES_AGENT_NAME}.json"),
            crate::cli::synth::kiro_cli_v2::SOP_SCOPES_SIDECAR_FILE,
            "RESERVED_SOP_SCOPES_AGENT_NAME must always name exactly the same file (minus \
             .json) as kiro_cli_v2::SOP_SCOPES_SIDECAR_FILE"
        );
    }

    /// The exact collision this reservation exists to prevent: an agent
    /// literally named `_skill_scopes` would write its own file to the
    /// same output path the skill-scope sidecar file writes to a moment
    /// later, silently clobbering the agent's file and then being
    /// excluded from the install-side copy pass.
    #[test]
    fn reject_unsafe_agent_name_rejects_reserved_skill_scopes_name() {
        assert!(reject_unsafe_agent_name("_skill_scopes").is_err());
    }

    /// Case-insensitive variants of the reserved name must be rejected
    /// too -- they resolve to the identical on-disk path once `.json` is
    /// appended, on a case-insensitive filesystem (macOS APFS default).
    #[test]
    fn reject_unsafe_agent_name_rejects_reserved_skill_scopes_name_case_variant() {
        assert!(reject_unsafe_agent_name("_Skill_Scopes").is_err());
        assert!(reject_unsafe_agent_name("_SKILL_SCOPES").is_err());
    }

    /// A genuine Unicode near-miss, not merely an ASCII case variant: the
    /// KELVIN SIGN (U+212A) is a distinct, non-ASCII codepoint whose
    /// Unicode-aware lowercase mapping is the plain ASCII letter `k`
    /// (confirmed below), yet `eq_ignore_ascii_case` folds ASCII letters
    /// only -- it never touches this codepoint's non-ASCII byte sequence,
    /// so a check built on it alone would have accepted this name outright
    /// even though `case_insensitive_fold_key`, the module's own stronger
    /// primitive (see that function's doc comment), folds it onto the
    /// exact same key as the reserved literal -- i.e. the same on-disk
    /// path (`_skill_scopes.json`) once written. This is the regression
    /// guard for the fix that made `reject_unsafe_agent_name` route
    /// through `case_insensitive_fold_key` instead of
    /// `eq_ignore_ascii_case`.
    #[test]
    fn reject_unsafe_agent_name_rejects_unicode_near_miss_of_reserved_skill_scopes_name() {
        let kelvin_sign = '\u{212A}';
        let near_miss = format!("_s{kelvin_sign}ill_scopes");
        assert!(
            !near_miss.eq_ignore_ascii_case(RESERVED_SKILL_SCOPES_AGENT_NAME),
            "sanity check: eq_ignore_ascii_case must NOT already treat this as a match -- \
             otherwise this test isn't exercising the ASCII-fold gap the fix closes; near_miss: \
             {near_miss:?}"
        );
        assert_eq!(
            case_insensitive_fold_key(&near_miss),
            case_insensitive_fold_key(RESERVED_SKILL_SCOPES_AGENT_NAME),
            "sanity check: case_insensitive_fold_key must unify this Unicode near-miss with the \
             reserved literal, or this test isn't exercising a real fold collision; near_miss: \
             {near_miss:?}"
        );
        assert!(
            reject_unsafe_agent_name(&near_miss).is_err(),
            "a Unicode near-miss that folds onto the reserved skill-scopes name via \
             case_insensitive_fold_key must be rejected just like an ASCII case variant; \
             near_miss: {near_miss:?}"
        );
    }

    /// A name that merely contains the reserved literal as a substring
    /// must remain accepted -- this reservation is deliberately narrow to
    /// the exact collision, not a broad substring ban.
    #[test]
    fn reject_unsafe_agent_name_accepts_name_that_merely_contains_reserved_skill_scopes_literal() {
        assert!(reject_unsafe_agent_name("my_skill_scopes_agent").is_ok());
        assert!(reject_unsafe_agent_name("_skill_scopes_v2").is_ok());
    }

    /// The reserved literal here plus a `.json` suffix must equal
    /// `kiro_cli_v2::SKILL_SCOPES_SIDECAR_FILE` exactly, so a future edit
    /// to either constant without the other is caught here rather than
    /// silently reopening the collision this module rejects.
    #[test]
    fn reserved_skill_scopes_agent_name_matches_sidecar_file_stem() {
        assert_eq!(
            format!("{RESERVED_SKILL_SCOPES_AGENT_NAME}.json"),
            crate::cli::synth::kiro_cli_v2::SKILL_SCOPES_SIDECAR_FILE,
            "RESERVED_SKILL_SCOPES_AGENT_NAME must always name exactly the same file (minus \
             .json) as kiro_cli_v2::SKILL_SCOPES_SIDECAR_FILE"
        );
    }

    #[test]
    fn reject_unsafe_skill_name_rejects_traversal_and_nul() {
        assert!(reject_unsafe_skill_name("../../evil").is_err());
        assert!(reject_unsafe_skill_name("evil\0name").is_err());
        assert!(reject_unsafe_skill_name("safe-skill-name").is_ok());
    }

    #[test]
    fn reject_unsafe_sop_name_rejects_traversal_and_nul() {
        assert!(reject_unsafe_sop_name("../../evil").is_err());
        assert!(reject_unsafe_sop_name("evil\0name").is_err());
        assert!(reject_unsafe_sop_name("safe-sop-name").is_ok());
    }

    #[test]
    fn reject_unsafe_context_name_rejects_traversal_and_nul() {
        assert!(reject_unsafe_context_name("../../evil").is_err());
        assert!(reject_unsafe_context_name("evil\0name").is_err());
        assert!(reject_unsafe_context_name("safe-context-name.md").is_ok());
    }

    // -- `reject_case_insensitive_model_collisions` (transformer-layer
    // defense-in-depth for a `CanonicalModel` built directly, bypassing
    // `parse_canonical`'s own case-insensitive collision checks). --

    use std::path::PathBuf;

    use crate::cli::synth::model::{AgentSpec, AuxiliaryFile, ContextDef, SopDef};
    use crate::cli::synth::parser::{AgentConfig, AgentDependencies, ClientConfig};

    fn bare_agent(name: &str) -> AgentSpec {
        AgentSpec {
            name: name.to_string(),
            config: AgentConfig {
                description: String::new(),
                system_prompt: String::new(),
                model: String::new(),
            },
            dependencies: AgentDependencies::default(),
            client_config: ClientConfig::default(),
        }
    }

    fn bare_skill(name: &str) -> SkillDef {
        SkillDef {
            name: name.to_string(),
            raw_frontmatter: format!("name: {name}\ndescription: d."),
            body: String::new(),
            auxiliary_files: Vec::new(),
        }
    }

    #[test]
    fn accepts_model_with_no_collisions() {
        let model = CanonicalModel {
            agents: vec![bare_agent("agent-a")],
            skills: vec![bare_skill("skill-a")],
            sops: vec![SopDef {
                name: "sop-a".to_string(),
                body: String::new(),
            }],
            context: vec![ContextDef {
                name: "context-a.md".to_string(),
                body: String::new(),
            }],
        };
        assert!(reject_case_insensitive_model_collisions(&model).is_ok());
    }

    /// The exact gap this function closes: a `CanonicalModel` built
    /// directly (not through `parse_canonical`, which would have caught
    /// this via `assert_unique_names`) with two case-varying agent names
    /// must still be rejected here, at the transformer layer.
    #[test]
    fn rejects_case_insensitive_agent_name_collision_bypassing_parser() {
        let model = CanonicalModel {
            agents: vec![bare_agent("MyAgent"), bare_agent("myagent")],
            ..Default::default()
        };
        let err = reject_case_insensitive_model_collisions(&model).unwrap_err();
        assert!(err.contains("collides case-insensitively"), "got: {err}");
        assert!(err.contains("agents"), "got: {err}");
    }

    #[test]
    fn rejects_case_insensitive_skill_name_collision_bypassing_parser() {
        let model = CanonicalModel {
            skills: vec![bare_skill("MySkill"), bare_skill("myskill")],
            ..Default::default()
        };
        let err = reject_case_insensitive_model_collisions(&model).unwrap_err();
        assert!(err.contains("collides case-insensitively"), "got: {err}");
        assert!(err.contains("skills"), "got: {err}");
    }

    #[test]
    fn rejects_case_insensitive_sop_name_collision_bypassing_parser() {
        let model = CanonicalModel {
            sops: vec![
                SopDef {
                    name: "MySop".to_string(),
                    body: String::new(),
                },
                SopDef {
                    name: "mysop".to_string(),
                    body: String::new(),
                },
            ],
            ..Default::default()
        };
        let err = reject_case_insensitive_model_collisions(&model).unwrap_err();
        assert!(err.contains("collides case-insensitively"), "got: {err}");
        assert!(err.contains("agent-sops"), "got: {err}");
    }

    #[test]
    fn rejects_case_insensitive_context_name_collision_bypassing_parser() {
        let model = CanonicalModel {
            context: vec![
                ContextDef {
                    name: "Notes.md".to_string(),
                    body: String::new(),
                },
                ContextDef {
                    name: "notes.md".to_string(),
                    body: String::new(),
                },
            ],
            ..Default::default()
        };
        let err = reject_case_insensitive_model_collisions(&model).unwrap_err();
        assert!(err.contains("collides case-insensitively"), "got: {err}");
        assert!(err.contains("context"), "got: {err}");
    }

    /// Auxiliary-file half of the same gap: two auxiliary files within
    /// one skill differing only by case must be rejected here too, not
    /// just when the model is built through `parse_canonical`.
    #[test]
    fn rejects_case_insensitive_auxiliary_file_collision_bypassing_parser() {
        let mut skill = bare_skill("aux-skill");
        skill.auxiliary_files = vec![
            AuxiliaryFile {
                relative_path: PathBuf::from("scripts/Run.sh"),
                content: b"#!/bin/sh\n".to_vec(),
                executable: true,
            },
            AuxiliaryFile {
                relative_path: PathBuf::from("scripts/run.sh"),
                content: b"#!/bin/sh\n".to_vec(),
                executable: true,
            },
        ];
        let model = CanonicalModel {
            skills: vec![skill],
            ..Default::default()
        };
        let err = reject_case_insensitive_model_collisions(&model).unwrap_err();
        assert!(err.contains("collides case-insensitively"), "got: {err}");
        assert!(err.contains("aux-skill"), "got: {err}");
    }
}
