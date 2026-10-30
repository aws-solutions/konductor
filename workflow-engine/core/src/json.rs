// SPDX-License-Identifier: Apache-2.0
//! A small JSON value with a stable text form: object keys are sorted, so the same data always renders to the same
//! bytes whatever order it was built in.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Json {
    Bool(bool),
    Number(u64),
    Str(String),
    Array(Vec<Json>),
    Object(BTreeMap<String, Json>),
}

impl Json {
    pub fn object() -> Json {
        Json::Object(BTreeMap::new())
    }

    pub fn str(text: &str) -> Json {
        Json::Str(text.to_string())
    }

    pub fn number(value: usize) -> Json {
        Json::Number(value as u64)
    }

    /// Sets a key of an object. Does nothing on another kind of value.
    pub fn insert(&mut self, key: &str, value: Json) {
        if let Json::Object(map) = self {
            map.insert(key.to_string(), value);
        }
    }

    /// One line, with no spaces.
    pub fn compact(&self) -> String {
        let mut out = String::new();
        self.write(&mut out, None, 0);
        out
    }

    /// Two-space indent, one entry per line, no final newline.
    pub fn pretty(&self) -> String {
        let mut out = String::new();
        self.write(&mut out, Some(2), 0);
        out
    }

    fn write(&self, out: &mut String, indent: Option<usize>, depth: usize) {
        match self {
            Json::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
            Json::Number(value) => out.push_str(&value.to_string()),
            Json::Str(text) => write_string(out, text),
            Json::Array(items) if items.is_empty() => out.push_str("[]"),
            Json::Object(map) if map.is_empty() => out.push_str("{}"),
            Json::Array(items) => {
                out.push('[');
                for (n, item) in items.iter().enumerate() {
                    separate(out, indent, depth + 1, n == 0);
                    item.write(out, indent, depth + 1);
                }
                close(out, indent, depth, ']');
            }
            Json::Object(map) => {
                out.push('{');
                for (n, (key, value)) in map.iter().enumerate() {
                    separate(out, indent, depth + 1, n == 0);
                    write_string(out, key);
                    out.push(':');
                    if indent.is_some() {
                        out.push(' ');
                    }
                    value.write(out, indent, depth + 1);
                }
                close(out, indent, depth, '}');
            }
        }
    }
}

fn separate(out: &mut String, indent: Option<usize>, depth: usize, first: bool) {
    if !first {
        out.push(',');
    }
    if let Some(width) = indent {
        out.push('\n');
        out.extend(std::iter::repeat_n(' ', width * depth));
    }
}

fn close(out: &mut String, indent: Option<usize>, depth: usize, bracket: char) {
    if let Some(width) = indent {
        out.push('\n');
        out.extend(std::iter::repeat_n(' ', width * depth));
    }
    out.push(bracket);
}

fn write_string(out: &mut String, text: &str) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 || c == '\u{7f}' => {
                out.push_str(&format!("\\u{:04x}", c as u32))
            }
            c => out.push(c),
        }
    }
    out.push('"');
}
