// SPDX-License-Identifier: Apache-2.0
//
// frontmatter.rs — minimal YAML frontmatter reader for `SKILL.md` files.
//
// This duplicates the frontmatter-parsing approach in `cli/konductor-rs`'s
// `synth::parse_canonical` module on purpose. `mcp/` and `cli/` are
// independent Cargo workspaces with no path dependency between them and
// no shared `common` crate — don't "fix" this duplication by adding one.
// The two readers still check different things: this one type-checks
// each field and rejects a genuinely wrong shape (a list or a mapping
// where a scalar belongs) as `SkipReason::FieldTypeMismatch`. For a bare
// scalar, it draws a narrower line than "any number is fine": an integer
// or boolean scalar (e.g. `version: 1`) is coerced to its string form,
// because that coercion is lossless. A float scalar (e.g. `version:
// 1.10`) is rejected instead of coerced — by the time this code sees
// it, `serde_yaml` has already parsed it as an IEEE float, so the
// original text is gone (`1.10` and `1.1` are indistinguishable at this
// point). Coercing it would silently corrupt the value, so it's rejected
// as `SkipReason::UnquotedFloatScalar` with a message that tells the
// author to quote it instead. The two readers are allowed to diverge
// further as each evolves.
//
// Parsing target: like the CLI's reader, this deserializes frontmatter
// into an untyped `serde_json::Value` via `serde_yaml::from_str`. That's
// a deliberate deviation from an earlier design draft, which specified
// `serde_yaml::Value`/`Mapping` instead — the two aren't interchangeable
// (different enum variants, e.g. `Value::Object` vs `Value::Mapping`),
// and this reader commits to the JSON shape to match what the CLI's
// reader already does.
//
// One exception: `parse_frontmatter` parses YAML exactly once, into
// `serde_yaml::Value` (whose Deserialize impl rejects a duplicate
// top-level key, unlike `serde_json::Value`'s), then converts that
// parsed value to `serde_json::Value` via `serde_json::to_value` rather
// than re-parsing the source text a second time.

use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::model::SkipReason;

/// Scan-time cap on `SKILL.md` size, checked before the file is read
/// into memory. The sole definition of this policy — the `get_skill`
/// tool handler's handler-time guard in the consuming server imports
/// this constant rather than declaring its own, so the two layers
/// can't silently drift apart.
pub const MAX_SKILL_FILE_BYTES: u64 = 1024 * 1024;

/// The frontmatter fields the scanner needs before folding them into a
/// `SkillRecord`, which also needs the file's path, size, and
/// provenance — none of which come from the frontmatter text itself.
///
/// `pub(crate)`, not `pub`: this is an intermediate shape consumed only
/// by `scanner::scan_directory` on its way to a `SkillRecord`.
/// `skill-lookup-mcp` (the crate's only consumer) never constructs or
/// matches on it directly — narrowed rather than disclosed as external
/// API surface.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FrontmatterRaw {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) version: Option<String>,
    pub(crate) tags: Vec<String>,
}

/// Reads and validates the frontmatter of a single `SKILL.md` file,
/// returning the four fields the scanner needs, or the `SkipReason`
/// explaining why the file couldn't be indexed.
///
/// Reads only the frontmatter region; the skill body is never inspected.
///
/// Stats the file before reading it: a file over `MAX_SKILL_FILE_BYTES`
/// is rejected as `SkipReason::OversizedSkillFile` and `fs::read` is
/// never called, so an oversized file can't exhaust memory at scan time.
///
/// `pub(crate)`, not `pub`: called only from `scanner::scan_directory`.
/// `skill-lookup-mcp` reaches indexed skills through `SkillIndex`, never
/// by parsing a `SKILL.md` file itself — narrowed rather than disclosed.
pub(crate) fn parse_frontmatter(path: &Path) -> Result<FrontmatterRaw, SkipReason> {
    let actual_bytes = fs::metadata(path)
        .map_err(|e| SkipReason::IoError(e.to_string()))?
        .len();
    if actual_bytes > MAX_SKILL_FILE_BYTES {
        return Err(SkipReason::OversizedSkillFile {
            actual_bytes,
            limit_bytes: MAX_SKILL_FILE_BYTES,
        });
    }

    let bytes = fs::read(path).map_err(|e| SkipReason::IoError(e.to_string()))?;
    let raw = String::from_utf8(bytes).map_err(|_| SkipReason::NonUtf8)?;

    let frontmatter_text = extract_frontmatter_text(&raw)?;

    // Single parse: `serde_yaml::Value` rejects a duplicate mapping key
    // outright (confirmed: a two-`name:` document errors with
    // "duplicate entry with key \"name\""), so parsing into it gets the
    // duplicate-key check for free. It's then converted to the
    // `serde_json::Value` used below via `serde_json::to_value` — an
    // in-memory round-trip, not a second YAML parse of the source text.
    let yaml_value: serde_yaml::Value = serde_yaml::from_str(frontmatter_text)
        .map_err(|e| SkipReason::MalformedYaml(e.to_string()))?;
    let value: Value =
        serde_json::to_value(&yaml_value).map_err(|e| SkipReason::MalformedYaml(e.to_string()))?;
    let obj = match value {
        Value::Object(map) => map,
        other => {
            return Err(SkipReason::MalformedYaml(format!(
                "frontmatter is not a YAML mapping (got a {})",
                yaml_type_name(&other)
            )));
        }
    };

    let name = match obj.get("name") {
        None | Some(Value::Null) => return Err(SkipReason::MissingName),
        Some(Value::String(s)) => s.trim().to_string(),
        Some(scalar @ (Value::Number(_) | Value::Bool(_))) => {
            lossless_scalar_to_string("name", scalar)?
                .trim()
                .to_string()
        }
        Some(other) => {
            return Err(SkipReason::FieldTypeMismatch(format!(
                "name: expected string, got {}",
                yaml_type_name(other)
            )));
        }
    };
    if name.is_empty() {
        return Err(SkipReason::EmptyName);
    }

    let description = match obj.get("description") {
        None | Some(Value::Null) => return Err(SkipReason::MissingDescription),
        Some(Value::String(s)) => s.clone(),
        Some(scalar @ (Value::Number(_) | Value::Bool(_))) => {
            lossless_scalar_to_string("description", scalar)?
        }
        Some(other) => {
            return Err(SkipReason::FieldTypeMismatch(format!(
                "description: expected string, got {}",
                yaml_type_name(other)
            )));
        }
    };

    let version = match obj.get("version") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(scalar @ (Value::Number(_) | Value::Bool(_))) => {
            Some(lossless_scalar_to_string("version", scalar)?)
        }
        Some(other) => {
            return Err(SkipReason::FieldTypeMismatch(format!(
                "version: expected string, got {}",
                yaml_type_name(other)
            )));
        }
    };

    let tags = match obj.get("tags") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| {
                item.as_str().map(str::to_string).ok_or_else(|| {
                    SkipReason::FieldTypeMismatch(format!(
                        "tags: expected list of strings, got a {} element",
                        yaml_type_name(item)
                    ))
                })
            })
            .collect::<Result<Vec<_>, _>>()?,
        Some(other) => {
            return Err(SkipReason::FieldTypeMismatch(format!(
                "tags: expected list, got {}",
                yaml_type_name(other)
            )));
        }
    };

    Ok(FrontmatterRaw {
        name,
        description,
        version,
        tags,
    })
}

/// Coerces a YAML/JSON integer or boolean scalar to its string form, or
/// rejects a float scalar with an actionable diagnostic.
///
/// A bare `version: 1` is entirely normal, common YAML — it parses as
/// `Value::Number`, not `Value::String`. Rejecting it with
/// `FieldTypeMismatch` would be a usability bug rather than a real type
/// error, so `name`, `description`, and `version` accept an integer or
/// boolean scalar here and coerce it to a string. That coercion is
/// lossless: `n.to_string()` on an integer reproduces the exact digits
/// YAML parsed, and `bool::to_string()` reproduces `true`/`false`
/// exactly.
///
/// A float scalar (e.g. `version: 1.10`) is different: `serde_yaml` has
/// already parsed it into an `f64` by the time this function runs, and
/// that parse already lost the original text — `1.10` and `1.1` become
/// the same `f64` and so the same string. There's no way to recover
/// "1.10" from that `f64` downstream, so rather than coerce it to a
/// silently wrong value, this rejects it as
/// `SkipReason::UnquotedFloatScalar`, naming the field and telling the
/// author to quote the value so YAML reads it as a string instead of a
/// number.
///
/// Only called with `Value::Number`/`Value::Bool`; any other variant is
/// unreachable from its call sites.
fn lossless_scalar_to_string(field: &str, value: &Value) -> Result<String, SkipReason> {
    match value {
        // Names the field but offers no example value: the source text is
        // already gone by this point, so any concrete value shown here
        // would be wrong for every input but the one it was written for.
        Value::Number(_) if value.is_f64() => Err(SkipReason::UnquotedFloatScalar(format!(
            "{field}: unquoted decimal scalar loses precision when parsed as YAML — wrap the value in quotes so YAML reads it as a string and preserves its exact text"
        ))),
        Value::Number(n) => Ok(n.to_string()),
        Value::Bool(b) => Ok(b.to_string()),
        other => unreachable!("lossless_scalar_to_string called with non-scalar {other:?}"),
    }
}

/// Extracts the raw YAML text between the opening `---` delimiter line
/// and the next one. A delimiter line must be exactly `---`, with an
/// optional trailing `\r` for CRLF files — nothing else on the line.
///
/// The opening delimiter must be the very first line of the file. That
/// requirement is what makes frontmatter a property of the file's head
/// rather than of its body: without it, a file with no frontmatter at
/// all but two `---` thematic breaks somewhere in its prose would have
/// that prose section read as frontmatter, and an attacker-controlled
/// body section would decide the skill's indexed `name`. The CLI reader
/// this one mirrors requires the same thing — see
/// `cli/konductor-rs/src/cli/synth/parse_canonical.rs`'s
/// `split_frontmatter`, which starts from `raw.strip_prefix("---")` — so
/// accepting a mid-file delimiter here would also index skills that
/// `konductor synth` rejects.
///
/// Returns `SkipReason::NoFrontmatterDelimiters` if the file doesn't
/// open with a delimiter line, or if no second one follows it.
fn extract_frontmatter_text(raw: &str) -> Result<&str, SkipReason> {
    let mut delimiter_line_starts = raw
        .split('\n')
        .scan(0usize, |offset, line| {
            let line_start = *offset;
            *offset += line.len() + 1; // +1 for the '\n' this split consumed
            Some((line_start, line))
        })
        .filter(|(_, line)| line.trim_end_matches('\r') == "---")
        .map(|(start, _)| start);

    let first = delimiter_line_starts
        .next()
        .ok_or(SkipReason::NoFrontmatterDelimiters)?;
    if first != 0 {
        // The first delimiter isn't the first line, so this file has no
        // frontmatter region — whatever follows is body prose.
        return Err(SkipReason::NoFrontmatterDelimiters);
    }
    let second = delimiter_line_starts
        .next()
        .ok_or(SkipReason::NoFrontmatterDelimiters)?;

    // Content begins right after the first delimiter line's own '\n' and
    // ends right before the second delimiter line starts.
    let first_line_end = raw[first..]
        .find('\n')
        .map(|i| first + i + 1)
        .unwrap_or(raw.len());
    Ok(&raw[first_line_end..second])
}

/// Human-readable type name for a `serde_json::Value`, used in
/// `FieldTypeMismatch`/`MalformedYaml` messages (e.g. "expected string,
/// got number").
fn yaml_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "list",
        Value::Object(_) => "mapping",
    }
}

/// Renders a `SkipReason` as the `SKIP <path>: ...` message used by
/// `ScanDiagnostic::emit_to_stderr` and any future log or wire output.
pub fn skip_reason_message(path: &Path, reason: &SkipReason) -> String {
    let path = path.display();
    match reason {
        SkipReason::MissingName => format!("SKIP {path}: missing required field 'name'"),
        SkipReason::MissingDescription => {
            format!("SKIP {path}: missing required field 'description'")
        }
        SkipReason::EmptyName => {
            format!("SKIP {path}: empty name (name field is blank or whitespace-only)")
        }
        SkipReason::FieldTypeMismatch(detail) => {
            format!("SKIP {path}: field type mismatch ({detail})")
        }
        SkipReason::UnquotedFloatScalar(detail) => {
            format!("SKIP {path}: unquoted decimal scalar ({detail})")
        }
        SkipReason::MalformedYaml(detail) => {
            format!("SKIP {path}: malformed YAML frontmatter ({detail})")
        }
        SkipReason::NoFrontmatterDelimiters => {
            format!("SKIP {path}: no valid frontmatter (expected two '---' delimiters)")
        }
        SkipReason::IoError(detail) => format!("SKIP {path}: {detail}"),
        SkipReason::NonUtf8 => format!("SKIP {path}: file is not valid UTF-8"),
        SkipReason::OversizedSkillFile {
            actual_bytes,
            limit_bytes,
        } => format!(
            "SKIP {path}: file too large ({actual_bytes} bytes exceeds the {limit_bytes}-byte limit)"
        ),
        SkipReason::TooManyEntries {
            dropped_count,
            limit,
        } => format!(
            "SKIP {path}: too many entries ({dropped_count} entr{} beyond the {limit}-entry-per-directory cap were dropped)",
            if *dropped_count == 1 { "y" } else { "ies" }
        ),
        SkipReason::BrokenSymlink => format!("SKIP {path}: broken symlink"),
        SkipReason::NotRegularFile => {
            format!("SKIP {path}: exists but is not a regular file")
        }
        SkipReason::SymlinkResolutionFailed(detail) => {
            format!("SKIP {path}: symlink resolution failed ({detail})")
        }
        SkipReason::DuplicateTarget(original) => format!(
            "SKIP {path}: duplicate target (already indexed via {})",
            original.display()
        ),
        SkipReason::IntraDirCaseCollision(winning_path) => format!(
            "SKIP {path}: intra-dir case collision (shadowed by {})",
            winning_path.display()
        ),
        SkipReason::SymlinkEscapesRoot(target) => format!(
            "SKIP {path}: symlink target {} escapes the configured --skills-dir root",
            target.display()
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, name: &str, content: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        fs::write(&path, content).unwrap();
        path
    }

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skill-lookup-frontmatter-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn valid_frontmatter_with_all_fields_parses() {
        let dir = temp_dir("valid-all-fields");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: My Skill\ndescription: Does a thing.\nversion: 1.2.3\ntags:\n  - a\n  - b\n---\n\nBody.\n",
        );
        let fm = parse_frontmatter(&path).unwrap();
        assert_eq!(fm.name, "My Skill");
        assert_eq!(fm.description, "Does a thing.");
        assert_eq!(fm.version, Some("1.2.3".to_string()));
        assert_eq!(fm.tags, vec!["a".to_string(), "b".to_string()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_optional_fields_default_absent() {
        let dir = temp_dir("missing-optional");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: minimal\ndescription: d.\n---\n\nBody.\n",
        );
        let fm = parse_frontmatter(&path).unwrap();
        assert_eq!(fm.version, None);
        assert_eq!(fm.tags, Vec::<String>::new());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_name_is_skipped() {
        let dir = temp_dir("missing-name");
        let path = write(&dir, "SKILL.md", "---\ndescription: d.\n---\n\nBody.\n");
        assert_eq!(parse_frontmatter(&path), Err(SkipReason::MissingName));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_frontmatter_key_is_skipped_not_last_value_wins() {
        let dir = temp_dir("duplicate-key");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: first\nname: second\ndescription: d.\n---\n\nBody.\n",
        );
        match parse_frontmatter(&path) {
            Err(SkipReason::MalformedYaml(detail)) => {
                assert!(
                    detail.contains("duplicate"),
                    "expected a duplicate-key message, got: {detail}"
                );
            }
            other => panic!("expected MalformedYaml (duplicate key), got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_description_is_skipped() {
        let dir = temp_dir("missing-description");
        let path = write(&dir, "SKILL.md", "---\nname: x\n---\n\nBody.\n");
        assert_eq!(
            parse_frontmatter(&path),
            Err(SkipReason::MissingDescription)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn null_name_is_treated_as_missing() {
        let dir = temp_dir("null-name");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: null\ndescription: d.\n---\n\nBody.\n",
        );
        assert_eq!(parse_frontmatter(&path), Err(SkipReason::MissingName));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn whitespace_only_name_is_empty() {
        let dir = temp_dir("whitespace-name");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: \"   \"\ndescription: d.\n---\n\nBody.\n",
        );
        assert_eq!(parse_frontmatter(&path), Err(SkipReason::EmptyName));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn name_trimmed_of_surrounding_whitespace() {
        let dir = temp_dir("trim-name");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: \"  spaced  \"\ndescription: d.\n---\n\nBody.\n",
        );
        let fm = parse_frontmatter(&path).unwrap();
        assert_eq!(fm.name, "spaced");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn name_wrong_type_is_field_type_mismatch() {
        // `name: 42` is no longer wrong-typed as of the numeric-scalar
        // coercion fix (see numeric_name_scalar_is_accepted_and_coerced_to_string) —
        // this test now exercises a genuinely wrong shape (a list)
        // instead, to keep covering "name rejects a bad shape."
        let dir = temp_dir("name-wrong-type");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname:\n  - a\n  - b\ndescription: d.\n---\n\nBody.\n",
        );
        match parse_frontmatter(&path) {
            Err(SkipReason::FieldTypeMismatch(detail)) => {
                assert!(detail.contains("name"));
                assert!(detail.contains("list"));
            }
            other => panic!("expected FieldTypeMismatch, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn description_wrong_type_is_field_type_mismatch() {
        // `description: true` is no longer wrong-typed as of the
        // numeric/bool-scalar coercion fix — this test now exercises a
        // genuinely wrong shape (a mapping) instead, to keep covering
        // "description rejects a bad shape."
        let dir = temp_dir("description-wrong-type");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: x\ndescription:\n  nested: true\n---\n\nBody.\n",
        );
        match parse_frontmatter(&path) {
            Err(SkipReason::FieldTypeMismatch(detail)) => {
                assert!(detail.contains("description"));
                assert!(detail.contains("mapping"));
            }
            other => panic!("expected FieldTypeMismatch, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn numeric_version_scalar_is_accepted_and_coerced_to_string() {
        let dir = temp_dir("numeric-version");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: x\ndescription: d.\nversion: 1\n---\n\nBody.\n",
        );
        let fm = parse_frontmatter(&path).unwrap();
        assert_eq!(fm.version, Some("1".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn float_version_scalar_is_rejected_with_actionable_message() {
        // Fix for f-b8c4a147: previously `version: 1.10` was silently
        // coerced to "1.1" because serde_yaml had already parsed it as
        // an f64 by the time scalar_to_string saw it. Now it's rejected
        // instead of silently corrupted, with a message telling the
        // author to quote the value.
        let dir = temp_dir("float-version-rejected");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: x\ndescription: d.\nversion: 1.10\n---\n\nBody.\n",
        );
        match parse_frontmatter(&path) {
            Err(SkipReason::UnquotedFloatScalar(detail)) => {
                assert!(
                    detail.contains("version"),
                    "expected message to name the field, got: {detail}"
                );
                assert!(
                    detail.contains("quote"),
                    "expected message to instruct quoting, got: {detail}"
                );
            }
            other => panic!("expected UnquotedFloatScalar, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn float_rejection_message_does_not_invent_a_value() {
        // The message used to hardcode `version: "1.10"` as its example,
        // which is wrong for every input but 1.10 — it told an author who
        // wrote `2.5` to quote a value they never used. The source text
        // isn't recoverable here, so the message names the field only.
        let dir = temp_dir("float-message-no-value");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: x\ndescription: d.\nversion: 2.5\n---\n\nBody.\n",
        );
        match parse_frontmatter(&path) {
            Err(SkipReason::UnquotedFloatScalar(detail)) => {
                assert!(detail.contains("version"), "got: {detail}");
                assert!(
                    !detail.contains("1.10"),
                    "message must not name a value the author didn't write, got: {detail}"
                );
            }
            other => panic!("expected UnquotedFloatScalar, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn quoted_float_version_is_accepted_verbatim() {
        // A quoted "1.10" is a Value::String, never touches the
        // scalar-coercion path at all, and so keeps its trailing zero.
        let dir = temp_dir("quoted-float-version");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: x\ndescription: d.\nversion: \"1.10\"\n---\n\nBody.\n",
        );
        let fm = parse_frontmatter(&path).unwrap();
        assert_eq!(fm.version, Some("1.10".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn float_name_scalar_is_rejected_consistently_with_version() {
        // name follows the same integer-accept/float-reject rule as
        // version — an unquoted decimal is rejected there too, not just
        // for version.
        let dir = temp_dir("float-name-rejected");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: 1.10\ndescription: d.\n---\n\nBody.\n",
        );
        match parse_frontmatter(&path) {
            Err(SkipReason::UnquotedFloatScalar(detail)) => {
                assert!(detail.contains("name"));
                assert!(detail.contains("quote"));
            }
            other => panic!("expected UnquotedFloatScalar, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn numeric_name_scalar_is_accepted_and_coerced_to_string() {
        let dir = temp_dir("numeric-name");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: 2024\ndescription: d.\n---\n\nBody.\n",
        );
        let fm = parse_frontmatter(&path).unwrap();
        assert_eq!(fm.name, "2024");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn version_wrong_type_is_field_type_mismatch() {
        let dir = temp_dir("version-wrong-type");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: x\ndescription: d.\nversion:\n  - 1\n  - 2\n---\n\nBody.\n",
        );
        match parse_frontmatter(&path) {
            Err(SkipReason::FieldTypeMismatch(detail)) => {
                assert!(detail.contains("version"));
                assert!(detail.contains("list"));
            }
            other => panic!("expected FieldTypeMismatch, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tags_wrong_type_is_field_type_mismatch() {
        let dir = temp_dir("tags-wrong-type");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: x\ndescription: d.\ntags: not-a-list\n---\n\nBody.\n",
        );
        match parse_frontmatter(&path) {
            Err(SkipReason::FieldTypeMismatch(detail)) => {
                assert!(detail.contains("tags"));
                assert!(detail.contains("string"));
            }
            other => panic!("expected FieldTypeMismatch, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tags_element_wrong_type_is_field_type_mismatch() {
        let dir = temp_dir("tags-element-wrong-type");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: x\ndescription: d.\ntags:\n  - a\n  - 5\n---\n\nBody.\n",
        );
        match parse_frontmatter(&path) {
            Err(SkipReason::FieldTypeMismatch(detail)) => {
                assert!(detail.contains("tags"));
                assert!(detail.contains("number"));
            }
            other => panic!("expected FieldTypeMismatch, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_frontmatter_delimiters_at_all_is_skipped() {
        let dir = temp_dir("no-delimiters");
        let path = write(
            &dir,
            "SKILL.md",
            "# Just a heading\n\nNo frontmatter here.\n",
        );
        assert_eq!(
            parse_frontmatter(&path),
            Err(SkipReason::NoFrontmatterDelimiters)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn body_thematic_breaks_are_not_read_as_frontmatter() {
        // The probe fixture for the frontmatter-injection finding: no
        // frontmatter at all, but two `---` thematic breaks in the body
        // bracketing what looks like frontmatter. Taking the first two
        // `---` lines from anywhere in the file indexed this as a skill
        // named "injected" — an attacker-controlled body section choosing
        // the skill's identity — while `konductor synth`, which requires
        // the delimiter at byte 0, rejected the same file.
        let dir = temp_dir("body-thematic-breaks");
        let path = write(
            &dir,
            "SKILL.md",
            "# Not a skill\n\nSome prose.\n\n---\nname: injected\ndescription: pwned\n---\n\nMore prose.\n",
        );
        assert_eq!(
            parse_frontmatter(&path),
            Err(SkipReason::NoFrontmatterDelimiters),
            "a `---` that isn't the first line must not open a frontmatter region"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn leading_blank_line_before_delimiter_is_not_frontmatter() {
        // Even a single blank line ahead of the `---` puts the delimiter
        // off byte 0, which is exactly what the CLI's `strip_prefix("---")`
        // rejects. Pinned separately from the injection case above so the
        // boundary itself is covered, not just the attack shape.
        let dir = temp_dir("leading-blank-line");
        let path = write(
            &dir,
            "SKILL.md",
            "\n---\nname: x\ndescription: d.\n---\n\nBody.\n",
        );
        assert_eq!(
            parse_frontmatter(&path),
            Err(SkipReason::NoFrontmatterDelimiters)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_one_frontmatter_delimiter_is_skipped() {
        let dir = temp_dir("one-delimiter");
        let path = write(&dir, "SKILL.md", "---\nname: x\ndescription: d.\n");
        assert_eq!(
            parse_frontmatter(&path),
            Err(SkipReason::NoFrontmatterDelimiters)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_yaml_is_skipped() {
        let dir = temp_dir("malformed-yaml");
        let path = write(&dir, "SKILL.md", "---\nname: [unclosed\n---\n\nBody.\n");
        match parse_frontmatter(&path) {
            Err(SkipReason::MalformedYaml(_)) => {}
            other => panic!("expected MalformedYaml, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn frontmatter_that_is_not_a_mapping_is_malformed_yaml() {
        let dir = temp_dir("non-mapping-frontmatter");
        // A bare YAML scalar between the delimiters, not a mapping.
        let path = write(&dir, "SKILL.md", "---\njust a string\n---\n\nBody.\n");
        match parse_frontmatter(&path) {
            Err(SkipReason::MalformedYaml(detail)) => {
                assert!(detail.contains("mapping"));
            }
            other => panic!("expected MalformedYaml, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_keys_are_tolerated() {
        let dir = temp_dir("unknown-keys");
        let path = write(
            &dir,
            "SKILL.md",
            "---\nname: x\ndescription: d.\ntype: agent\nsome_future_field: whatever\n---\n\nBody.\n",
        );
        let fm = parse_frontmatter(&path).unwrap();
        assert_eq!(fm.name, "x");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn crlf_line_endings_are_tolerated() {
        let dir = temp_dir("crlf");
        let path = write(
            &dir,
            "SKILL.md",
            "---\r\nname: x\r\ndescription: d.\r\n---\r\n\r\nBody.\r\n",
        );
        let fm = parse_frontmatter(&path).unwrap();
        assert_eq!(fm.name, "x");
        assert_eq!(fm.description, "d.");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn non_utf8_file_is_skipped() {
        let dir = temp_dir("non-utf8");
        let path = dir.join("SKILL.md");
        // 0xFF is not valid UTF-8 in this position.
        fs::write(&path, [0xFFu8, 0xFE, 0x00, 0x01]).unwrap();
        assert_eq!(parse_frontmatter(&path), Err(SkipReason::NonUtf8));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn io_error_on_nonexistent_file_is_skipped() {
        let dir = temp_dir("io-error");
        let path = dir.join("does-not-exist.md");
        match parse_frontmatter(&path) {
            Err(SkipReason::IoError(_)) => {}
            other => panic!("expected IoError, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn oversized_skill_file_is_rejected_before_read() {
        // Regression for the unbounded-read finding: a SKILL.md over
        // MAX_SKILL_FILE_BYTES must be rejected by a stat check, before
        // `fs::read` is ever called on it.
        let dir = temp_dir("oversized-skill-file");
        let padding = "x".repeat((MAX_SKILL_FILE_BYTES as usize) + 1);
        let path = write(
            &dir,
            "SKILL.md",
            &format!("---\nname: big\ndescription: d.\n---\n\n{padding}\n"),
        );
        match parse_frontmatter(&path) {
            Err(SkipReason::OversizedSkillFile {
                actual_bytes,
                limit_bytes,
            }) => {
                assert!(actual_bytes > limit_bytes);
                assert_eq!(limit_bytes, MAX_SKILL_FILE_BYTES);
            }
            other => panic!("expected OversizedSkillFile, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_at_exactly_the_size_limit_is_accepted() {
        // The cap is "greater than the limit", not "at least the limit" —
        // a file exactly at MAX_SKILL_FILE_BYTES must still parse.
        let dir = temp_dir("exactly-at-limit");
        let prefix = "---\nname: x\ndescription: d.\n---\n\n";
        let padding_len = (MAX_SKILL_FILE_BYTES as usize) - prefix.len();
        let padding = "x".repeat(padding_len);
        let path = write(&dir, "SKILL.md", &format!("{prefix}{padding}"));
        assert_eq!(
            fs::metadata(&path).unwrap().len(),
            MAX_SKILL_FILE_BYTES,
            "fixture must be exactly at the limit"
        );
        assert!(parse_frontmatter(&path).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn intra_dir_case_collision_renders_as_skip_not_warn() {
        // Every SkipReason renders as "SKIP <path>: ..." (see
        // skip_reason_message and ScanDiagnostic::emit_to_stderr) — an
        // operator grepping for "SKIP" must catch this one too, even
        // though it's conceptually a collision rather than a parse error.
        let path = Path::new("/skills/foo/SKILL.md");
        let winning = std::path::PathBuf::from("/skills/Foo/SKILL.md");
        let message =
            skip_reason_message(path, &SkipReason::IntraDirCaseCollision(winning.clone()));
        assert!(
            message.starts_with("SKIP "),
            "expected message to start with 'SKIP ', got: {message}"
        );
        assert!(!message.starts_with("WARN"), "got: {message}");
    }
}
