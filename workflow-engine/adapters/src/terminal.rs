// SPDX-License-Identifier: Apache-2.0
//! The terminal: stdin and stderr. The summary and the question go to stderr, so a run that prints JSON on stdout keeps
//! that stream clean.

use std::io::{BufRead, IsTerminal, Write};

use workflow_core::ports::Terminal;

pub struct StdTerminal;

impl Terminal for StdTerminal {
    /// A person can be asked when both the input and the stream the question goes to are a terminal.
    fn is_available(&self) -> bool {
        std::io::stdin().is_terminal() && std::io::stderr().is_terminal()
    }

    fn ask_yes_no(&mut self, summary: &str, question: &str) -> bool {
        let mut err = std::io::stderr();
        let _ = write!(err, "{summary}\n{question} ");
        let _ = err.flush();
        let mut answer = String::new();
        if std::io::stdin().lock().read_line(&mut answer).is_err() {
            return false;
        }
        matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes")
    }
}
