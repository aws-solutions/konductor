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

    fn confirm(&mut self, summary: &str, question: &str, code: &str) -> bool {
        let mut err = std::io::stderr();
        let _ = write!(err, "{summary}\n{question} ");
        let _ = err.flush();
        let mut answer = String::new();
        if std::io::stdin().lock().read_line(&mut answer).is_err() {
            return false;
        }
        is_confirmation(&answer, code)
    }
}

/// Whether `answer` is `code`, ignoring case and the space around it. An empty code never matches.
fn is_confirmation(answer: &str, code: &str) -> bool {
    let code = code.trim();
    !code.is_empty() && answer.trim().eq_ignore_ascii_case(code)
}

#[cfg(test)]
mod tests {
    use super::is_confirmation;

    #[test]
    fn only_the_code_confirms() {
        assert!(is_confirmation("a1b2c3d4\n", "a1b2c3d4"));
        assert!(is_confirmation("  A1B2C3D4 \r\n", "a1b2c3d4"));
        for answer in [
            "y\n",
            "yes\n",
            "\n",
            "",
            "a1b2c3d\n",
            "a1b2c3d45\n",
            "y a1b2c3d4\n",
        ] {
            assert!(!is_confirmation(answer, "a1b2c3d4"), "{answer:?}");
        }
        assert!(!is_confirmation("\n", ""));
    }
}
