// SPDX-License-Identifier: Apache-2.0
//! The checks never panic, and every position they report is real, whatever the text is. The texts here are the
//! example workflow with random edits. The generator is a fixed xorshift, so a failure repeats.

mod common;

use common::{MemorySource, VALID};
use workflow_core::source_map::SourceMap;
use workflow_core::{check_text, Checked};

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

/// Pieces that YAML treats as structure, plus text that is hard on offsets.
const PIECES: &[&str] = &[
    "-",
    ": ",
    ":",
    "? ",
    "|",
    ">",
    "|-",
    ">+2",
    "&a ",
    "*a",
    "!!str ",
    "<<",
    "'",
    "\"",
    "\\",
    "\\u00",
    "#",
    " #",
    "[",
    "]",
    "{",
    "}",
    ",",
    "\n",
    "\r",
    "\r\n",
    "\t",
    " ",
    "  ",
    "---\n",
    "...\n",
    "%YAML 1.2\n",
    "\u{feff}",
    "é",
    "😀",
    "\u{0}",
    "\u{85}",
    "\u{2028}",
    "~",
    "null",
    "true",
    "0x1F",
    "1e3",
    ".inf",
    "stages",
    "name",
    "agent",
    "prompt",
    "prompt_file",
    "outputs",
    "intent",
    "format",
    "version",
    "accept",
    "params",
    "goal",
    "file",
    "run",
    "id",
];

fn mutate(text: &str, rng: &mut Rng) -> String {
    let mut chars: Vec<char> = text.chars().collect();
    for _ in 0..1 + rng.below(4) {
        let at = rng.below(chars.len() + 1);
        match rng.below(3) {
            0 => {
                let piece: Vec<char> = PIECES[rng.below(PIECES.len())].chars().collect();
                chars.splice(at..at, piece);
            }
            1 if at < chars.len() => {
                let end = (at + 1 + rng.below(6)).min(chars.len());
                chars.drain(at..end);
            }
            _ if at < chars.len() => {
                let piece: Vec<char> = PIECES[rng.below(PIECES.len())].chars().collect();
                chars.splice(at..at + 1, piece);
            }
            _ => {}
        }
    }
    chars.into_iter().collect()
}

fn assert_positions_are_real(text: &str, checked: &Checked) {
    let map = SourceMap::new(text);
    let lines = map.position(text.len()).line;
    for d in &checked.diagnostics {
        assert!(d.line >= 1 && d.column >= 1, "{d:?} in {text:?}");
        assert!(d.end_line >= 1 && d.end_column >= 1, "{d:?} in {text:?}");
        assert!(d.line <= lines && d.end_line <= lines, "{d:?} in {text:?}");
        assert!(
            (d.end_line, d.end_column) >= (d.line, d.column),
            "{d:?} in {text:?}"
        );
        assert!(!d.message.is_empty());
    }
    assert!(
        checked.workflow.is_none() || checked.diagnostics.is_empty(),
        "a workflow with diagnostics: {text:?}"
    );
    assert!(
        checked.workflow.is_some() || !checked.diagnostics.is_empty(),
        "neither a workflow nor a diagnostic: {text:?}"
    );
}

#[test]
fn random_edits_of_a_workflow_never_panic_and_always_report_real_positions() {
    let hello = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/hello-plan.yml"),
    )
    .expect("read the example");
    let source = MemorySource::with("plan.md", "Plan it.".as_bytes());
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    for base in [VALID, hello.as_str()] {
        for _ in 0..6000 {
            let text = mutate(base, &mut rng);
            let checked = check_text("hello-plan", &text, &source);
            assert_positions_are_real(&text, &checked);
        }
    }
}

#[test]
fn random_bytes_that_are_text_never_panic() {
    let mut rng = Rng(0x1234_5678_9ABC_DEF1);
    let source = MemorySource::default();
    for _ in 0..3000 {
        let length = rng.below(120);
        let text: String = (0..length)
            .map(|_| {
                let pick = PIECES[rng.below(PIECES.len())];
                if rng.below(3) == 0 {
                    pick.to_string()
                } else {
                    char::from(32 + rng.below(95) as u8).to_string()
                }
            })
            .collect();
        let checked = check_text("t", &text, &source);
        assert_positions_are_real(&text, &checked);
    }
}
