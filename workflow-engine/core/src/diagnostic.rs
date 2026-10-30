// SPDX-License-Identifier: Apache-2.0
//! Diagnostics: what a check reports, with the fields of the canvas API contract's `Diagnostic` schema.

use crate::json::Json;

/// A code is upper snake case. It is never renamed or reused (D4). It says what happened, not which inputs trigger it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Code {
    // The 12 codes shared with the canvas API contract.
    YamlSyntax,
    YamlUnsupported,
    NotAMapping,
    UnknownKey,
    DuplicateKey,
    MissingKey,
    WrongType,
    InvalidName,
    ReservedName,
    DuplicateStage,
    NameMismatch,
    InvalidValue,
    // The codes the workflow design adds.
    UnsupportedFormat,
    StageKindMissing,
    StageKindAmbiguous,
    NotSupportedByThisBuild,
}

impl Code {
    /// Every code, in the order the spec lists them.
    pub const ALL: [Code; 16] = [
        Code::YamlSyntax,
        Code::YamlUnsupported,
        Code::NotAMapping,
        Code::UnknownKey,
        Code::DuplicateKey,
        Code::MissingKey,
        Code::WrongType,
        Code::InvalidName,
        Code::ReservedName,
        Code::DuplicateStage,
        Code::NameMismatch,
        Code::InvalidValue,
        Code::UnsupportedFormat,
        Code::StageKindMissing,
        Code::StageKindAmbiguous,
        Code::NotSupportedByThisBuild,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Code::YamlSyntax => "YAML_SYNTAX",
            Code::YamlUnsupported => "YAML_UNSUPPORTED",
            Code::NotAMapping => "NOT_A_MAPPING",
            Code::UnknownKey => "UNKNOWN_KEY",
            Code::DuplicateKey => "DUPLICATE_KEY",
            Code::MissingKey => "MISSING_KEY",
            Code::WrongType => "WRONG_TYPE",
            Code::InvalidName => "INVALID_NAME",
            Code::ReservedName => "RESERVED_NAME",
            Code::DuplicateStage => "DUPLICATE_STAGE",
            Code::NameMismatch => "NAME_MISMATCH",
            Code::InvalidValue => "INVALID_VALUE",
            Code::UnsupportedFormat => "UNSUPPORTED_FORMAT",
            Code::StageKindMissing => "STAGE_KIND_MISSING",
            Code::StageKindAmbiguous => "STAGE_KIND_AMBIGUOUS",
            Code::NotSupportedByThisBuild => "NOT_SUPPORTED_BY_THIS_BUILD",
        }
    }

    /// Every first-release code is an error and stops the command. A later slice may add warnings and infos.
    pub const fn severity(self) -> Severity {
        Severity::Error
    }
}

/// How much a diagnostic matters. Only errors exist in this release.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
}

impl Severity {
    pub const fn as_str(self) -> &'static str {
        match self {
            Severity::Error => "error",
        }
    }
}

/// One finding of a check, with its place in the text. `line` and `column` count from 1, and a column counts code
/// points. The end is the first place after the key or value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: Code,
    pub severity: Severity,
    pub file: String,
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
    pub message: String,
    pub suggestion: Option<String>,
}

impl Diagnostic {
    pub fn to_json(&self) -> Json {
        let mut object = Json::object();
        object.insert("code", Json::str(self.code.as_str()));
        object.insert("severity", Json::str(self.severity.as_str()));
        object.insert("file", Json::str(&self.file));
        object.insert("path", Json::str(&self.path));
        object.insert("line", Json::number(self.line));
        object.insert("column", Json::number(self.column));
        object.insert("end_line", Json::number(self.end_line));
        object.insert("end_column", Json::number(self.end_column));
        object.insert("message", Json::str(&self.message));
        if let Some(suggestion) = &self.suggestion {
            object.insert("suggestion", Json::str(suggestion));
        }
        object
    }
}
