// SPDX-License-Identifier: Apache-2.0
//! What a user types to name a workflow.

use crate::rules::is_name;

/// A workflow named on the command line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reference {
    /// A bare name: the project file, then the user file (D5).
    Local(String),
    /// `library/<name>`: the shipped workflow of that name (D6).
    Shipped(String),
}

/// Why an argument names no workflow.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReferenceError {
    /// The name does not follow the name pattern.
    InvalidName,
}

/// Reads the argument of a command. A name that does not follow the name pattern is refused here, which also keeps
/// every path character out of the lookup.
pub fn parse_reference(arg: &str) -> Result<Reference, ReferenceError> {
    if let Some(name) = arg.strip_prefix("library/") {
        return if is_name(name) {
            Ok(Reference::Shipped(name.to_string()))
        } else {
            Err(ReferenceError::InvalidName)
        };
    }
    if is_name(arg) {
        Ok(Reference::Local(arg.to_string()))
    } else {
        Err(ReferenceError::InvalidName)
    }
}
