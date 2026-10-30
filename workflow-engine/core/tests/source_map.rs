// SPDX-License-Identifier: Apache-2.0
//! Lines, columns and offsets.

use workflow_core::source_map::{Position, SourceMap};

fn at(map: &SourceMap, offset: usize) -> (usize, usize) {
    let p: Position = map.position(offset);
    (p.line, p.column)
}

#[test]
fn lines_and_columns_count_from_one() {
    let map = SourceMap::new("ab\ncd\n\nef");
    assert_eq!(at(&map, 0), (1, 1));
    assert_eq!(at(&map, 1), (1, 2));
    assert_eq!(at(&map, 2), (1, 3)); // the line break itself
    assert_eq!(at(&map, 3), (2, 1));
    assert_eq!(at(&map, 6), (3, 1));
    assert_eq!(at(&map, 7), (4, 1));
    assert_eq!(at(&map, 9), (4, 3)); // the end of the text
}

#[test]
fn a_line_ends_at_lf_crlf_or_a_lone_cr() {
    let map = SourceMap::new("a\nb\r\nc\rd");
    assert_eq!(at(&map, 2), (2, 1));
    assert_eq!(at(&map, 5), (3, 1));
    assert_eq!(at(&map, 7), (4, 1));
    // The CR of a CRLF is the end of its line, and the LF is not another line.
    assert_eq!(at(&map, 3), (2, 2));
    assert_eq!(at(&map, 4), (2, 3));
}

#[test]
fn a_column_counts_code_points_and_a_tab_counts_as_one() {
    let text = "\t😀é𝄞x";
    let map = SourceMap::new(text);
    let after = |chars: usize| {
        text.char_indices()
            .nth(chars)
            .map_or(text.len(), |(at, _)| at)
    };
    assert_eq!(at(&map, after(0)), (1, 1));
    assert_eq!(at(&map, after(1)), (1, 2));
    assert_eq!(at(&map, after(2)), (1, 3));
    assert_eq!(at(&map, after(3)), (1, 4));
    assert_eq!(at(&map, after(4)), (1, 5));
    assert_eq!(at(&map, after(5)), (1, 6));
}

#[test]
fn a_byte_order_mark_takes_no_column() {
    let map = SourceMap::new("\u{feff}a: 1\nb: 2");
    assert_eq!(at(&map, 0), (1, 1));
    assert_eq!(at(&map, 3), (1, 1));
    assert_eq!(at(&map, 4), (1, 2));
    assert_eq!(at(&map, 3 + 5), (2, 1));
}

#[test]
fn a_byte_offset_inside_a_character_moves_back_to_its_start() {
    let map = SourceMap::new("é!");
    assert_eq!(at(&map, 1), (1, 1));
    assert_eq!(at(&map, 2), (1, 2));
}

#[test]
fn an_offset_past_the_end_is_the_end() {
    let map = SourceMap::new("ab");
    assert_eq!(at(&map, 99), (1, 3));
}

#[test]
fn character_indexes_become_byte_offsets() {
    let ascii = SourceMap::new("abc");
    assert_eq!(ascii.byte_of_char(0), 0);
    assert_eq!(ascii.byte_of_char(2), 2);
    assert_eq!(ascii.byte_of_char(3), 3);
    assert_eq!(ascii.byte_of_char(99), 3);
    let text = "a😀é\u{feff}z";
    let wide = SourceMap::new(text);
    assert_eq!(wide.byte_of_char(0), 0);
    assert_eq!(wide.byte_of_char(1), 1);
    assert_eq!(wide.byte_of_char(2), 5);
    assert_eq!(wide.byte_of_char(3), 7);
    assert_eq!(wide.byte_of_char(4), 10);
    assert_eq!(wide.byte_of_char(5), text.len());
    assert_eq!(wide.byte_of_char(99), text.len());
}

#[test]
fn empty_text_has_one_line() {
    let map = SourceMap::new("");
    assert_eq!(at(&map, 0), (1, 1));
}
