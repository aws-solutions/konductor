// SPDX-License-Identifier: Apache-2.0
//
// synth/context_load.rs: the optional `load` front matter on a context
// file. A file without front matter is emitted exactly as written.

use serde_json::Value;

use super::parse_canonical::split_frontmatter;
use super::parser::ParseError;

/// Context files that must always load in full, because they hold the
/// rules every agent or orchestrator follows on every turn.
pub(super) const PINNED_CONTEXT_FILES: &[&str] =
    &["k-core-rules.md", "k-orchestrator-routing-rules.md"];

const LOAD_KEY: &str = "load";
const LOAD_ALWAYS: &str = "always";
const LOAD_ON_DEMAND: &str = "on_demand";

/// Returns the body synth emits for context file `name`: `raw` itself
/// when there is no front matter, otherwise the text after it.
///
/// Accepts `load: always` and `load: on_demand`; both emit the body
/// unchanged. `on_demand` is validated but does not yet change how the
/// file loads. `load: on_demand` fails on a pinned file.
pub(super) fn strip_load_front_matter<'a>(
    name: &str,
    raw: &'a str,
    file_label: &str,
) -> Result<&'a str, ParseError> {
    if raw
        .strip_prefix('\u{FEFF}')
        .is_some_and(starts_with_front_matter_fence)
    {
        return Err(ParseError {
            file: file_label.to_string(),
            field: None,
            reason: "a byte order mark precedes the front matter; remove it".to_string(),
        });
    }
    if !starts_with_front_matter_fence(raw) {
        return Ok(raw);
    }
    let (front_matter, body) = split_frontmatter(raw, file_label)?;
    let load = read_load_value(front_matter, file_label)?;
    let error = |reason: String| ParseError {
        file: file_label.to_string(),
        field: Some(LOAD_KEY.to_string()),
        reason,
    };
    match load.as_str() {
        LOAD_ON_DEMAND if PINNED_CONTEXT_FILES.contains(&name) => Err(error(format!(
            "context file '{name}' is pinned and must load in full; \
             'load: {LOAD_ON_DEMAND}' is not allowed on it \
             (use 'load: {LOAD_ALWAYS}' or remove the front matter)"
        ))),
        LOAD_ALWAYS | LOAD_ON_DEMAND => Ok(body),
        other => Err(error(format!(
            "unknown load value '{other}' (expected '{LOAD_ALWAYS}' or '{LOAD_ON_DEMAND}')"
        ))),
    }
}

fn starts_with_front_matter_fence(text: &str) -> bool {
    text.starts_with("---\n") || text.starts_with("---\r\n")
}

fn read_load_value(front_matter: &str, file_label: &str) -> Result<String, ParseError> {
    let error = |field: Option<&str>, reason: String| ParseError {
        file: file_label.to_string(),
        field: field.map(str::to_string),
        reason,
    };
    let value: Value = serde_yaml::from_str(front_matter)
        .map_err(|e| error(None, format!("invalid YAML front matter: {e}")))?;
    let Value::Object(map) = value else {
        return Err(error(
            None,
            "front matter must be a YAML mapping".to_string(),
        ));
    };
    if let Some(key) = map.keys().find(|k| k.as_str() != LOAD_KEY) {
        return Err(error(
            Some(key),
            format!("unknown front-matter key '{key}' (only '{LOAD_KEY}' is supported)"),
        ));
    }
    match map.get(LOAD_KEY) {
        Some(Value::String(load)) => Ok(load.clone()),
        Some(_) => Err(error(Some(LOAD_KEY), "load must be a string".to_string())),
        None => Err(error(
            Some(LOAD_KEY),
            "front matter must set 'load'".to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    const LABEL: &str = "context/example.md";

    #[test]
    fn file_without_front_matter_is_unchanged() {
        let raw = "# Rules\n\nBody.\n";
        assert_eq!(
            strip_load_front_matter("example.md", raw, LABEL).unwrap(),
            raw
        );
    }

    #[test]
    fn horizontal_rule_after_first_line_is_not_front_matter() {
        let raw = "# Rules\n---\nload: on_demand\n---\n";
        assert_eq!(
            strip_load_front_matter("example.md", raw, LABEL).unwrap(),
            raw
        );
    }

    #[test]
    fn load_always_front_matter_is_stripped() {
        let raw = "---\nload: always\n---\n\n# Rules\n\nBody.\n";
        assert_eq!(
            strip_load_front_matter("example.md", raw, LABEL).unwrap(),
            "# Rules\n\nBody.\n"
        );
    }

    #[test]
    fn load_always_front_matter_is_stripped_on_a_pinned_file() {
        let raw = "---\r\nload: always\r\n---\r\n# Rules\r\n";
        assert_eq!(
            strip_load_front_matter("k-core-rules.md", raw, LABEL).unwrap(),
            "# Rules\r\n"
        );
    }

    #[test]
    fn on_demand_on_each_pinned_file_is_rejected() {
        for name in PINNED_CONTEXT_FILES {
            let raw = "---\nload: on_demand\n---\n# Rules\n";
            let err = strip_load_front_matter(name, raw, LABEL).unwrap_err();
            assert_eq!(err.field.as_deref(), Some("load"));
            assert!(
                err.reason.contains(&format!("'{name}' is pinned")),
                "got: {err}"
            );
        }
    }

    #[test]
    fn on_demand_front_matter_is_stripped_on_an_unpinned_file() {
        let raw = "---\nload: on_demand\n---\n# Notes\n";
        assert_eq!(
            strip_load_front_matter("notes.md", raw, LABEL).unwrap(),
            "# Notes\n"
        );
    }

    #[test]
    fn unknown_load_value_is_rejected() {
        let raw = "---\nload: sometimes\n---\n# Notes\n";
        let err = strip_load_front_matter("notes.md", raw, LABEL).unwrap_err();
        assert!(
            err.reason.contains("unknown load value 'sometimes'"),
            "got: {err}"
        );
    }

    #[test]
    fn unknown_front_matter_key_is_rejected() {
        let raw = "---\nlaod: on_demand\n---\n# Rules\n";
        let err = strip_load_front_matter("k-core-rules.md", raw, LABEL).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("laod"));
    }

    #[test]
    fn front_matter_without_load_is_rejected() {
        let raw = "---\n{}\n---\n# Notes\n";
        let err = strip_load_front_matter("notes.md", raw, LABEL).unwrap_err();
        assert!(err.reason.contains("must set 'load'"), "got: {err}");
    }

    #[test]
    fn unclosed_front_matter_is_rejected() {
        let raw = "---\nload: always\n# Notes\n";
        let err = strip_load_front_matter("notes.md", raw, LABEL).unwrap_err();
        assert!(err.reason.contains("missing closing '---'"), "got: {err}");
    }

    #[test]
    fn byte_order_mark_before_front_matter_is_rejected() {
        let raw = "\u{FEFF}---\nload: on_demand\n---\n# Rules\n";
        let err = strip_load_front_matter("k-core-rules.md", raw, LABEL).unwrap_err();
        assert!(err.reason.contains("byte order mark"), "got: {err}");
    }

    #[test]
    fn empty_front_matter_block_is_rejected() {
        let raw = "---\n---\nBody\n";
        assert!(strip_load_front_matter("notes.md", raw, LABEL).is_err());
    }

    #[test]
    fn leading_thematic_break_is_parsed_as_front_matter_and_rejected() {
        let raw = "---\n\n# Title\n\n---\n\nText\n";
        let err = strip_load_front_matter("notes.md", raw, LABEL).unwrap_err();
        assert!(err.reason.contains("YAML mapping"), "got: {err}");
    }

    /// Every shipped context file has no front matter, so synth must emit
    /// each one byte for byte. The pinned names must also still exist.
    #[test]
    fn shipped_context_files_pass_through_unchanged_and_pinned_files_exist() {
        let context_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../context");
        for entry in fs::read_dir(&context_dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_str().unwrap().to_string();
            let raw = fs::read_to_string(&path).unwrap();
            assert_eq!(
                strip_load_front_matter(&name, &raw, LABEL).unwrap(),
                raw,
                "{name} changed"
            );
        }
        for name in PINNED_CONTEXT_FILES {
            assert!(
                context_dir.join(name).is_file(),
                "pinned file {name} is missing"
            );
        }
    }
}
