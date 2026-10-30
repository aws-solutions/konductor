// SPDX-License-Identifier: Apache-2.0
//! The loader: a thin tree builder over the event parser of the `saphyr-parser` crate.
//!
//! The parser gives events with character positions. It also reports anchors, aliases, tags, extra documents and the
//! `<<` key, which this builder rejects as `YAML_UNSUPPORTED`. It does not detect duplicate keys, so the builder does.
//! The builder enforces the nesting limit over the events, so a deeply nested file stops being read at the limit.
//!
//! The parser counts characters, and the builder keeps byte offsets. Two spans the parser gives are not exact, so the
//! builder finds them itself: a quoted scalar, whose end can run past the closing quote over a trailing comment, and
//! a block scalar, which starts after its header line.

use std::collections::BTreeSet;

use saphyr_parser::{Event, Parser, ScalarStyle, Span as ParserSpan};

use crate::diagnostic::Code;
use crate::limits::MAX_YAML_DEPTH;
use crate::report::{quote, Problem, Seg, Span};
use crate::source_map::SourceMap;

/// How a plain scalar reads in the YAML 1.2 core schema. A quoted or block scalar is always a string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScalarKind {
    Str,
    Null,
    Bool,
    Int,
    Float,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scalar {
    pub text: String,
    pub kind: ScalarKind,
    pub span: Span,
}

impl Scalar {
    pub fn is_string(&self) -> bool {
        self.kind == ScalarKind::Str
    }
}

/// One `key: value` pair. A key that repeats an earlier key of the same mapping is kept and marked, so that the
/// checks can go on as if it were not there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub key: Scalar,
    pub value: Node,
    pub duplicate: bool,
}

impl Entry {
    /// The span of the value, or of the key when the value has no text (`key:` with nothing after it).
    pub fn value_span(&self) -> Span {
        let span = self.value.span();
        if span.is_empty() {
            self.key.span
        } else {
            span
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Map {
    pub entries: Vec<Entry>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Seq {
    pub items: Vec<Node>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    Scalar(Scalar),
    Map(Map),
    Seq(Seq),
}

impl Node {
    pub fn span(&self) -> Span {
        match self {
            Node::Scalar(scalar) => scalar.span,
            Node::Map(map) => map.span,
            Node::Seq(seq) => seq.span,
        }
    }
}

/// What loading found: the tree, if there is one, and the problems of the YAML itself.
#[derive(Debug)]
pub struct Loaded {
    pub root: Option<Node>,
    pub problems: Vec<Problem>,
}

impl Loaded {
    /// The text could not be read as the supported subset of YAML, so the checks of the format must not run.
    pub fn is_unreadable(&self) -> bool {
        self.problems
            .iter()
            .any(|p| matches!(p.code, Code::YamlSyntax | Code::YamlUnsupported))
    }
}

/// Reads the text as exactly one YAML document of plain data.
pub fn load(text: &str, map: &SourceMap) -> Loaded {
    let mut builder = Builder {
        parser: Parser::new_from_str(text),
        text,
        map,
        problems: Vec::new(),
        furthest: 0,
    };
    let root = builder.stream().unwrap_or(None);
    let mut problems = builder.problems;
    // A syntax error makes the rest of the findings unreliable, so it is the only one reported.
    if problems.iter().any(|p| p.code == Code::YamlSyntax) {
        problems.retain(|p| p.code == Code::YamlSyntax);
        return Loaded {
            root: None,
            problems,
        };
    }
    Loaded { root, problems }
}

/// Reading stopped: a syntax error, or the nesting limit. The problem is already recorded.
struct Stop;

struct Builder<'a> {
    parser: Parser<'a, saphyr_parser::StrInput<'a>>,
    text: &'a str,
    map: &'a SourceMap<'a>,
    problems: Vec<Problem>,
    // The end of the furthest content seen, used for the span of an extra document.
    furthest: usize,
}

impl<'a> Builder<'a> {
    fn next(&mut self) -> Result<(Event<'a>, ParserSpan), Stop> {
        match self.parser.next_event() {
            Some(Ok(item)) => Ok(item),
            Some(Err(error)) => {
                let at = self.map.byte_of_char(error.marker().index());
                // The scanner reads a whole line of flow brackets before it gives the first event, and stops at its
                // own nesting limit of 255. That is the same finding as this crate's limit, found earlier.
                let problem = if error.info().starts_with("recursion limit exceeded") {
                    let message =
                        format!("The YAML is nested more than {MAX_YAML_DEPTH} levels deep.");
                    Problem::new(Code::YamlUnsupported, &[], Span::new(at, at + 1), message)
                } else {
                    let message = format!("The text is not valid YAML: {}.", error.info());
                    Problem::new(Code::YamlSyntax, &[], Span::new(at, at), message)
                };
                self.problems.push(problem);
                Err(Stop)
            }
            None => Err(Stop),
        }
    }

    fn byte(&self, marker_index: usize) -> usize {
        self.map.byte_of_char(marker_index)
    }

    /// The whole stream: no document, or one document, then the end. A later document is `YAML_UNSUPPORTED`.
    fn stream(&mut self) -> Result<Option<Node>, Stop> {
        self.next()?; // StreamStart
        let (event, _) = self.next()?;
        let Event::DocumentStart(_) = event else {
            return Ok(None); // StreamEnd: nothing but blank lines and comments
        };
        let root = self.node(&mut Vec::new(), 0)?;
        self.next()?; // DocumentEnd
        loop {
            let (event, span) = self.next()?;
            match event {
                Event::DocumentStart(_) => {
                    let start = self.byte(span.start.index());
                    self.furthest = self.byte(span.end.index());
                    self.skip_document()?;
                    let end = self.furthest.max(start);
                    self.problems.push(Problem::new(
                        Code::YamlUnsupported,
                        &[],
                        Span::new(start, end),
                        "Only one YAML document is allowed.",
                    ));
                }
                _ => return Ok(Some(root)),
            }
        }
    }

    /// Reads one node and everything in it. `depth` is the number of collections around it.
    fn node(&mut self, path: &mut Vec<Seg>, depth: usize) -> Result<Node, Stop> {
        let (event, span) = self.next()?;
        self.node_from(event, span, path, depth)
    }

    fn node_from(
        &mut self,
        event: Event<'a>,
        span: ParserSpan,
        path: &mut Vec<Seg>,
        depth: usize,
    ) -> Result<Node, Stop> {
        match event {
            Event::Scalar(value, style, anchor, tag) => {
                self.reject_marks(anchor != 0, tag.is_some(), &span, path);
                Ok(Node::Scalar(self.scalar(&value, style, &span)))
            }
            Event::Alias(_) => {
                let at = Span::new(self.byte(span.start.index()), self.byte(span.end.index()));
                self.problems.push(Problem::new(
                    Code::YamlUnsupported,
                    path,
                    at,
                    "A `*` reference is not allowed.",
                ));
                Ok(Node::Scalar(Scalar {
                    text: String::new(),
                    kind: ScalarKind::Null,
                    span: at,
                }))
            }
            Event::SequenceStart(anchor, tag) => {
                self.reject_marks(anchor != 0, tag.is_some(), &span, path);
                self.sequence(&span, path, depth)
            }
            Event::MappingStart(anchor, tag) => {
                self.reject_marks(anchor != 0, tag.is_some(), &span, path);
                self.mapping(&span, path, depth)
            }
            _ => {
                let at = self.byte(span.start.index());
                self.problems.push(Problem::new(
                    Code::YamlSyntax,
                    &[],
                    Span::new(at, at),
                    "The text is not valid YAML: unexpected structure.",
                ));
                Err(Stop)
            }
        }
    }

    fn reject_marks(&mut self, anchor: bool, tag: bool, span: &ParserSpan, path: &[Seg]) {
        if !anchor && !tag {
            return;
        }
        let at = Span::new(self.byte(span.start.index()), self.byte(span.end.index()));
        if anchor {
            self.problems.push(Problem::new(
                Code::YamlUnsupported,
                path,
                at,
                "An anchor is not allowed.",
            ));
        }
        if tag {
            self.problems.push(Problem::new(
                Code::YamlUnsupported,
                path,
                at,
                "A tag is not allowed.",
            ));
        }
    }

    fn enter(&mut self, span: &ParserSpan, path: &[Seg], depth: usize) -> Result<usize, Stop> {
        let depth = depth + 1;
        if depth > MAX_YAML_DEPTH {
            let at = self.byte(span.start.index());
            self.problems.push(Problem::new(
                Code::YamlUnsupported,
                path,
                Span::new(at, at + 1),
                format!("The YAML is nested more than {MAX_YAML_DEPTH} levels deep."),
            ));
            return Err(Stop);
        }
        Ok(depth)
    }

    fn sequence(
        &mut self,
        start: &ParserSpan,
        path: &mut Vec<Seg>,
        depth: usize,
    ) -> Result<Node, Stop> {
        let depth = self.enter(start, path, depth)?;
        let begin = self.byte(start.start.index());
        let mut items: Vec<Node> = Vec::new();
        let end = loop {
            let (event, span) = self.next()?;
            if let Event::SequenceEnd = event {
                break self.collection_end(begin, &span, items.last().map(|item| item.span().end));
            }
            path.push(Seg::Index(items.len()));
            let item = self.node_from(event, span, path, depth);
            path.pop();
            items.push(item?);
        };
        self.furthest = self.furthest.max(end);
        Ok(Node::Seq(Seq {
            items,
            span: Span::new(begin, end),
        }))
    }

    fn mapping(
        &mut self,
        start: &ParserSpan,
        path: &mut Vec<Seg>,
        depth: usize,
    ) -> Result<Node, Stop> {
        let depth = self.enter(start, path, depth)?;
        let begin = self.byte(start.start.index());
        let mut entries: Vec<Entry> = Vec::new();
        let mut seen: BTreeSet<String> = BTreeSet::new();
        let end = loop {
            let (event, span) = self.next()?;
            if let Event::MappingEnd = event {
                let last = entries
                    .last()
                    .map(|e| e.value.span().end.max(e.key.span.end));
                break self.collection_end(begin, &span, last);
            }
            let key = self.key(event, span, path, depth)?;
            let (event, span) = self.next()?;
            let Some(key) = key else {
                self.skip_from(event, &span, depth)?;
                continue;
            };
            let duplicate = !seen.insert(key.text.clone());
            if duplicate {
                let message = format!("The key {} is already used.", quote(&key.text));
                let mut at = path.clone();
                at.push(Seg::Key(key.text.clone()));
                self.problems
                    .push(Problem::new(Code::DuplicateKey, &at, key.span, message));
            }
            path.push(Seg::Key(key.text.clone()));
            let value = self.node_from(event, span, path, depth);
            path.pop();
            entries.push(Entry {
                key,
                value: value?,
                duplicate,
            });
        };
        self.furthest = self.furthest.max(end);
        Ok(Node::Map(Map {
            entries,
            span: Span::new(begin, end),
        }))
    }

    /// Reads a key. Only a plain scalar can be a key. Anything else is reported and skipped, and gives `None`.
    fn key(
        &mut self,
        event: Event<'a>,
        span: ParserSpan,
        path: &[Seg],
        depth: usize,
    ) -> Result<Option<Scalar>, Stop> {
        let Event::Scalar(value, style, anchor, tag) = event else {
            let at = Span::new(self.byte(span.start.index()), self.byte(span.end.index()));
            self.problems.push(Problem::new(
                Code::YamlUnsupported,
                path,
                at,
                "A key must be a plain value.",
            ));
            self.skip_from(event, &span, depth)?;
            return Ok(None);
        };
        self.reject_marks(anchor != 0, tag.is_some(), &span, path);
        let scalar = self.scalar(&value, style, &span);
        if value == "<<" && style == ScalarStyle::Plain {
            self.problems.push(Problem::new(
                Code::YamlUnsupported,
                path,
                scalar.span,
                "A merge key is not allowed.",
            ));
        }
        Ok(Some(scalar))
    }

    /// Reads and drops the rest of a node whose first event is `event`.
    fn skip_from(&mut self, event: Event<'a>, span: &ParserSpan, depth: usize) -> Result<(), Stop> {
        let mut open = 0;
        let mut event = event;
        let mut span = *span;
        loop {
            match event {
                Event::SequenceStart(..) | Event::MappingStart(..) => {
                    open += 1;
                    self.enter(&span, &[], depth + open - 1)?;
                }
                Event::SequenceEnd | Event::MappingEnd => {
                    open = open.saturating_sub(1);
                    // Only a flow collection has a closing bracket. A block collection ends with its last child.
                    let at = self.byte(span.start.index());
                    if matches!(self.text.as_bytes().get(at), Some(b']' | b'}')) {
                        self.furthest = self.furthest.max(at + 1);
                    }
                }
                Event::Scalar(value, style, ..) => {
                    let scalar = self.scalar(&value, style, &span);
                    self.furthest = self.furthest.max(scalar.span.end);
                }
                _ => {}
            }
            if open == 0 {
                return Ok(());
            }
            (event, span) = self.next()?;
        }
    }

    /// Reads the events of an extra document up to its end, so that its span is known.
    fn skip_document(&mut self) -> Result<(), Stop> {
        let (event, span) = self.next()?;
        if let Event::DocumentEnd = event {
            return Ok(());
        }
        self.skip_from(event, &span, 0)?;
        self.next()?; // DocumentEnd
        Ok(())
    }

    /// The end of a collection. A flow collection ends after its closing bracket. A block collection ends where its
    /// last child ends. The end event of a flow collection can run on over a comment, so only its first byte is used.
    fn collection_end(
        &self,
        begin: usize,
        end_event: &ParserSpan,
        last_child_end: Option<usize>,
    ) -> usize {
        let closing = self.byte(end_event.start.index());
        let opens_flow = matches!(self.text.as_bytes().get(begin), Some(b'[' | b'{'));
        let closes_flow = matches!(self.text.as_bytes().get(closing), Some(b']' | b'}'));
        if opens_flow && closes_flow {
            closing + 1
        } else {
            last_child_end.map_or(begin, |end| end.max(begin))
        }
    }

    fn scalar(&self, value: &str, style: ScalarStyle, span: &ParserSpan) -> Scalar {
        let start = self.byte(span.start.index());
        let parser_end = self.byte(span.end.index());
        let (span, kind) = match style {
            ScalarStyle::Plain => (Span::new(start, parser_end), resolve_plain(value)),
            ScalarStyle::SingleQuoted | ScalarStyle::DoubleQuoted => (
                Span::new(start, quoted_end(self.text, start, style, parser_end)),
                ScalarKind::Str,
            ),
            ScalarStyle::Literal | ScalarStyle::Folded => {
                (block_span(self.text, start, parser_end), ScalarKind::Str)
            }
        };
        Scalar {
            text: value.to_string(),
            kind,
            span,
        }
    }
}

/// The byte after the closing quote of a quoted scalar that starts at `start`. The parser's own end can include a
/// comment that follows the scalar, so the quote is found by reading the text. `fallback` is used if no closing quote
/// is found.
fn quoted_end(text: &str, start: usize, style: ScalarStyle, fallback: usize) -> usize {
    let bytes = text.as_bytes();
    let quote = if style == ScalarStyle::DoubleQuoted {
        b'"'
    } else {
        b'\''
    };
    if bytes.get(start) != Some(&quote) {
        return fallback;
    }
    let mut i = start + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' if quote == b'"' => i += 2,
            b if b == quote && quote == b'\'' && bytes.get(i + 1) == Some(&b'\'') => i += 2,
            b if b == quote => return i + 1,
            _ => i += 1,
        }
    }
    fallback
}

/// The span of a literal or folded block scalar: from its header (`|`, `>-`) to the end of its last line of content.
/// The parser starts the scalar at its first line of content, so the header is found by reading back over the lines
/// before it. If no header is found, the span starts at the content.
fn block_span(text: &str, content_start: usize, parser_end: usize) -> Span {
    let content_end = parser_end.min(text.len()).max(content_start);
    let content_last = content_start + text[content_start..content_end].trim_end().len();
    match block_header(text, content_start) {
        Some((start, len)) => Span::new(start, content_last.max(start + len)),
        None => Span::new(content_start, content_last),
    }
}

/// The start and length of the block scalar header on the last non-blank line before `content_start`.
fn block_header(text: &str, content_start: usize) -> Option<(usize, usize)> {
    let before = text[..content_start].trim_end();
    let line_start = before.rfind(['\n', '\r']).map_or(0, |at| at + 1);
    let line = &before[line_start..];
    for (at, c) in line.char_indices() {
        if c != '|' && c != '>' {
            continue;
        }
        let after_space = at == 0 || line[..at].ends_with(char::is_whitespace);
        let tail = &line[at + 1..];
        let rest = tail.trim_start_matches(|d: char| d.is_ascii_digit() || d == '+' || d == '-');
        let indicators = tail.len() - rest.len();
        let only_comment = rest.trim().is_empty()
            || (rest.starts_with(char::is_whitespace) && rest.trim_start().starts_with('#'));
        if after_space && only_comment {
            return Some((line_start + at, 1 + indicators));
        }
    }
    None
}

/// How a plain scalar resolves in the YAML 1.2 core schema.
pub fn resolve_plain(text: &str) -> ScalarKind {
    match text {
        "" | "~" | "null" | "Null" | "NULL" => ScalarKind::Null,
        "true" | "True" | "TRUE" | "false" | "False" | "FALSE" => ScalarKind::Bool,
        ".inf" | ".Inf" | ".INF" | "+.inf" | "+.Inf" | "+.INF" | "-.inf" | "-.Inf" | "-.INF"
        | ".nan" | ".NaN" | ".NAN" => ScalarKind::Float,
        _ if is_int(text) => ScalarKind::Int,
        _ if is_float(text) => ScalarKind::Float,
        _ => ScalarKind::Str,
    }
}

fn is_int(text: &str) -> bool {
    if let Some(octal) = text.strip_prefix("0o") {
        return !octal.is_empty() && octal.bytes().all(|b| (b'0'..=b'7').contains(&b));
    }
    if let Some(hex) = text.strip_prefix("0x") {
        return !hex.is_empty() && hex.bytes().all(|b| b.is_ascii_hexdigit());
    }
    let digits = text.strip_prefix(['-', '+']).unwrap_or(text);
    !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
}

/// `[-+]? ( \. [0-9]+ | [0-9]+ ( \. [0-9]* )? ) ( [eE] [-+]? [0-9]+ )?`
fn is_float(text: &str) -> bool {
    let body = text.strip_prefix(['-', '+']).unwrap_or(text);
    let (mantissa, exponent) = match body.find(['e', 'E']) {
        Some(at) => (&body[..at], Some(&body[at + 1..])),
        None => (body, None),
    };
    if let Some(exponent) = exponent {
        let digits = exponent.strip_prefix(['-', '+']).unwrap_or(exponent);
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
    }
    let (whole, fraction) = match mantissa.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (mantissa, None),
    };
    let all_digits = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
    match fraction {
        // `.5`, `1.`, `1.5`
        Some(fraction) => {
            all_digits(whole) && all_digits(fraction) && (!whole.is_empty() || !fraction.is_empty())
        }
        // `1e3`: digits alone are an integer, so an exponent must be there
        None => exponent.is_some() && !whole.is_empty() && all_digits(whole),
    }
}
