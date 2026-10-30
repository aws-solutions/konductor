// SPDX-License-Identifier: Apache-2.0
//! The port through which the core reaches workflow files. The adapters crate implements it.

use crate::rules::decode_file;

/// Where a workflow and its prompt files come from. One source stands for one folder of workflows.
///
/// An implementation reads a file only if it is a regular file with the expected name that stays inside the folder.
/// A link, a directory, a missing file and a file over the size limit all give `None`, and nothing is read through
/// them (spec: "Rules for every file").
pub trait WorkflowSource {
    /// The bytes of `<name>.yml`, or `None` if it is not there.
    fn workflow_bytes(&self, name: &str) -> Option<Vec<u8>>;

    /// The bytes of a prompt file. `path` is relative to the folder of the workflow and already follows the path
    /// rules. `None` if the file is not there.
    fn prompt_file_bytes(&self, path: &str) -> Option<Vec<u8>>;
}

/// The text of workflow `name`, or `None` if the source has none that the engine may read: missing, over the size
/// limit or not UTF-8.
pub fn read_workflow_text(source: &dyn WorkflowSource, name: &str) -> Option<String> {
    source.workflow_bytes(name).and_then(decode_file)
}
