// SPDX-License-Identifier: Apache-2.0
//! Positions in a text. The YAML parser counts characters. The engine keeps byte offsets and reports lines and columns,
//! so this converts between the three.

/// A line and a column, both counted from 1. A column counts code points, and a tab counts as one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Position {
    pub line: usize,
    pub column: usize,
}

/// Turns offsets into positions. A line ends at LF, CRLF or a lone CR. A byte order mark at the start of the text
/// takes no column, because an editor does not show it.
#[derive(Debug)]
pub struct SourceMap<'a> {
    text: &'a str,
    // Byte offset of the first character of each line.
    line_starts: Vec<usize>,
    // Byte offset of each character, kept only when the text is not plain ASCII.
    char_starts: Option<Vec<usize>>,
    // Bytes at the start of the text that take no column.
    bom: usize,
}

impl<'a> SourceMap<'a> {
    pub fn new(text: &'a str) -> SourceMap<'a> {
        let bom = if text.starts_with('\u{feff}') { 3 } else { 0 };
        let bytes = text.as_bytes();
        let mut line_starts = vec![bom];
        let mut i = 0;
        while i < bytes.len() {
            match bytes[i] {
                b'\r' if bytes.get(i + 1) == Some(&b'\n') => {
                    i += 1;
                    line_starts.push(i + 1);
                }
                b'\n' | b'\r' => line_starts.push(i + 1),
                _ => {}
            }
            i += 1;
        }
        let char_starts =
            (!text.is_ascii()).then(|| text.char_indices().map(|(at, _)| at).collect());
        SourceMap {
            text,
            line_starts,
            char_starts,
            bom,
        }
    }

    /// The byte offset of the character at `index`. An index past the end maps to the end of the text.
    pub fn byte_of_char(&self, index: usize) -> usize {
        match &self.char_starts {
            None => index.min(self.text.len()),
            Some(starts) => starts.get(index).copied().unwrap_or(self.text.len()),
        }
    }

    /// The position of a byte offset, which must be on a character boundary or is moved back to one.
    pub fn position(&self, offset: usize) -> Position {
        let mut offset = offset.min(self.text.len()).max(self.bom);
        while !self.text.is_char_boundary(offset) {
            offset -= 1;
        }
        let line = self.line_starts.partition_point(|&start| start <= offset) - 1;
        let start = self.line_starts[line];
        Position {
            line: line + 1,
            column: self.text[start..offset].chars().count() + 1,
        }
    }
}
