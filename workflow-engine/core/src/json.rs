// SPDX-License-Identifier: Apache-2.0
//! A small JSON value with a stable text form: object keys are sorted, so the same data always renders to the same
//! bytes whatever order it was built in. [`parse`] reads JSON text into the same value.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(u64),
    /// A number that is not a whole number from 0 to `u64::MAX`, kept as the text it was parsed from.
    OtherNumber(String),
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

    /// The value of a key of an object, or `None` for a missing key or another kind of value.
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(map) => map.get(key),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(text) => Some(text),
            _ => None,
        }
    }

    pub fn as_u64(&self) -> Option<u64> {
        match self {
            Json::Number(value) => Some(*value),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Array(items) => Some(items),
            _ => None,
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
            Json::Null => out.push_str("null"),
            Json::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
            Json::Number(value) => out.push_str(&value.to_string()),
            Json::OtherNumber(text) => out.push_str(text),
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

/// Why a text is not JSON that [`parse`] accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseError {
    /// Not JSON (RFC 8259), or text after the value.
    Syntax,
    /// An object has the same key twice. JSON leaves this open, and a reader that kept either one could be fooled.
    DuplicateKey,
    /// Arrays and objects nest deeper than [`MAX_PARSE_DEPTH`].
    TooDeep,
}

/// How deep [`parse`] lets arrays and objects nest, so that hostile text cannot exhaust the stack.
pub const MAX_PARSE_DEPTH: usize = 64;

/// How deep [`parse_lenient`] lets arrays and objects nest. It is for reading a file that another program loads, and
/// such a program accepts more nesting than [`parse`] does.
pub const MAX_LENIENT_DEPTH: usize = 128;

/// Parses one JSON value (RFC 8259), with optional white space around it.
pub fn parse(text: &str) -> Result<Json, ParseError> {
    let mut parser = Parser::new(text, MAX_PARSE_DEPTH, false);
    parser.finish().map(|value| value.0)
}

/// What [`parse_lenient`] read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lenient {
    pub value: Json,
    /// The keys that the top-level object has more than once, each listed once per repeat. The value of such a key is
    /// the last one. A key repeated deeper in the value is not listed.
    pub repeated_keys: Vec<String>,
}

/// Like [`parse`], for reading a file that another program loads, so that this reader does not refuse what that
/// program takes: arrays and objects may nest up to [`MAX_LENIENT_DEPTH`], and an object may repeat a key. The caller
/// decides what a repeat of a top-level key means, and a repeat deeper in the value is ignored.
pub fn parse_lenient(text: &str) -> Result<Lenient, ParseError> {
    let mut parser = Parser::new(text, MAX_LENIENT_DEPTH, true);
    parser.finish().map(|(value, repeated_keys)| Lenient {
        value,
        repeated_keys,
    })
}

struct Parser<'a> {
    bytes: &'a [u8],
    at: usize,
    max_depth: usize,
    /// Whether this is the lenient reader: an object may repeat a key (the last value is kept, and a repeat of a top-level
    /// key is recorded), and a number too large for an f64 is refused.
    allow_repeats: bool,
    repeated: Vec<String>,
}

impl<'a> Parser<'a> {
    fn new(text: &'a str, max_depth: usize, allow_repeats: bool) -> Parser<'a> {
        Parser {
            bytes: text.as_bytes(),
            at: 0,
            max_depth,
            allow_repeats,
            repeated: Vec::new(),
        }
    }

    /// The one value of the text, and the top-level keys it repeats.
    fn finish(&mut self) -> Result<(Json, Vec<String>), ParseError> {
        self.skip_space();
        let value = self.value(0)?;
        self.skip_space();
        if self.at == self.bytes.len() {
            Ok((value, std::mem::take(&mut self.repeated)))
        } else {
            Err(ParseError::Syntax)
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn skip_space(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.at += 1;
        }
    }

    fn expect(&mut self, byte: u8) -> Result<(), ParseError> {
        if self.peek() == Some(byte) {
            self.at += 1;
            Ok(())
        } else {
            Err(ParseError::Syntax)
        }
    }

    fn literal(&mut self, word: &[u8], value: Json) -> Result<Json, ParseError> {
        if self.bytes[self.at..].starts_with(word) {
            self.at += word.len();
            Ok(value)
        } else {
            Err(ParseError::Syntax)
        }
    }

    fn value(&mut self, depth: usize) -> Result<Json, ParseError> {
        match self.peek() {
            Some(b'{') => self.object(depth + 1),
            Some(b'[') => self.array(depth + 1),
            Some(b'"') => self.string().map(Json::Str),
            Some(b't') => self.literal(b"true", Json::Bool(true)),
            Some(b'f') => self.literal(b"false", Json::Bool(false)),
            Some(b'n') => self.literal(b"null", Json::Null),
            Some(b'-' | b'0'..=b'9') => self.number(),
            _ => Err(ParseError::Syntax),
        }
    }

    fn object(&mut self, depth: usize) -> Result<Json, ParseError> {
        if depth > self.max_depth {
            return Err(ParseError::TooDeep);
        }
        self.expect(b'{')?;
        let mut map = BTreeMap::new();
        self.skip_space();
        if self.peek() == Some(b'}') {
            self.at += 1;
            return Ok(Json::Object(map));
        }
        loop {
            self.skip_space();
            let key = self.string()?;
            self.skip_space();
            self.expect(b':')?;
            self.skip_space();
            let value = self.value(depth)?;
            let repeated_key = key.clone();
            if map.insert(key, value).is_some() {
                if !self.allow_repeats {
                    return Err(ParseError::DuplicateKey);
                }
                // `depth` is 1 for the top-level object.
                if depth == 1 {
                    self.repeated.push(repeated_key);
                }
            }
            self.skip_space();
            match self.peek() {
                Some(b',') => self.at += 1,
                Some(b'}') => {
                    self.at += 1;
                    return Ok(Json::Object(map));
                }
                _ => return Err(ParseError::Syntax),
            }
        }
    }

    fn array(&mut self, depth: usize) -> Result<Json, ParseError> {
        if depth > self.max_depth {
            return Err(ParseError::TooDeep);
        }
        self.expect(b'[')?;
        let mut items = Vec::new();
        self.skip_space();
        if self.peek() == Some(b']') {
            self.at += 1;
            return Ok(Json::Array(items));
        }
        loop {
            self.skip_space();
            items.push(self.value(depth)?);
            self.skip_space();
            match self.peek() {
                Some(b',') => self.at += 1,
                Some(b']') => {
                    self.at += 1;
                    return Ok(Json::Array(items));
                }
                _ => return Err(ParseError::Syntax),
            }
        }
    }

    fn number(&mut self) -> Result<Json, ParseError> {
        let start = self.at;
        if self.peek() == Some(b'-') {
            self.at += 1;
        }
        match self.peek() {
            Some(b'0') => self.at += 1,
            Some(b'1'..=b'9') => self.digits(),
            _ => return Err(ParseError::Syntax),
        }
        if self.peek() == Some(b'.') {
            self.at += 1;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(ParseError::Syntax);
            }
            self.digits();
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.at += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.at += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(ParseError::Syntax);
            }
            self.digits();
        }
        // The slice is ASCII digits and signs, so it is valid UTF-8.
        let text = String::from_utf8_lossy(&self.bytes[start..self.at]).into_owned();
        match text.parse::<u64>() {
            Ok(value) => Ok(Json::Number(value)),
            // The program that loads a file read by `parse_lenient` rejects a number too large for an f64 (`1e999`).
            Err(_) if self.allow_repeats && text.parse::<f64>().is_ok_and(f64::is_infinite) => {
                Err(ParseError::Syntax)
            }
            Err(_) => Ok(Json::OtherNumber(text)),
        }
    }

    fn digits(&mut self) {
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.at += 1;
        }
    }

    fn string(&mut self) -> Result<String, ParseError> {
        self.expect(b'"')?;
        let mut out = String::new();
        loop {
            let start = self.at;
            while !matches!(self.peek(), None | Some(b'"' | b'\\')) {
                if self.bytes[self.at] < 0x20 {
                    return Err(ParseError::Syntax);
                }
                self.at += 1;
            }
            // The input is a `str` and the run stops at an ASCII byte, so it ends on a character boundary.
            out.push_str(
                std::str::from_utf8(&self.bytes[start..self.at]).map_err(|_| ParseError::Syntax)?,
            );
            match self.peek() {
                Some(b'"') => {
                    self.at += 1;
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.at += 1;
                    out.push(self.escape()?);
                }
                _ => return Err(ParseError::Syntax),
            }
        }
    }

    fn escape(&mut self) -> Result<char, ParseError> {
        let byte = self.peek().ok_or(ParseError::Syntax)?;
        self.at += 1;
        Ok(match byte {
            b'"' => '"',
            b'\\' => '\\',
            b'/' => '/',
            b'b' => '\u{8}',
            b'f' => '\u{c}',
            b'n' => '\n',
            b'r' => '\r',
            b't' => '\t',
            b'u' => {
                let high = self.hex4()?;
                if (0xd800..0xdc00).contains(&high) {
                    self.expect(b'\\')?;
                    self.expect(b'u')?;
                    let low = self.hex4()?;
                    if !(0xdc00..0xe000).contains(&low) {
                        return Err(ParseError::Syntax);
                    }
                    let code = 0x10000 + ((high - 0xd800) << 10) + (low - 0xdc00);
                    char::from_u32(code).ok_or(ParseError::Syntax)?
                } else {
                    char::from_u32(high).ok_or(ParseError::Syntax)?
                }
            }
            _ => return Err(ParseError::Syntax),
        })
    }

    fn hex4(&mut self) -> Result<u32, ParseError> {
        let digits = self
            .bytes
            .get(self.at..self.at + 4)
            .ok_or(ParseError::Syntax)?;
        let mut value = 0;
        for &digit in digits {
            let nibble = (digit as char).to_digit(16).ok_or(ParseError::Syntax)?;
            value = value * 16 + nibble;
        }
        self.at += 4;
        Ok(value)
    }
}
