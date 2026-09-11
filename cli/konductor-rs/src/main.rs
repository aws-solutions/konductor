// SPDX-License-Identifier: Apache-2.0

mod cli;

use std::process::ExitCode;

fn main() -> ExitCode {
    let parsed = cli::parse_or_exit();
    cli::run(parsed)
}
