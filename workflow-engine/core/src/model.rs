// SPDX-License-Identifier: Apache-2.0
//! The resolved workflow: what a file that passes every check means, with defaults applied and prompt files read.

use std::collections::BTreeMap;

use crate::json::Json;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Workflow {
    pub format: String,
    pub name: String,
    pub version: String,
    pub intent: Intent,
    /// The declared params. `goal` is always present, declared or not.
    pub params: BTreeMap<String, Param>,
    pub stages: Vec<Stage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Intent {
    pub outcome: String,
    pub accept: Vec<Check>,
}

/// A check in `intent.accept`. Only the `file` kind exists in this release.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    pub id: String,
    pub file: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Param {
    pub description: Option<String>,
    pub default: Option<String>,
}

/// An agent stage. `prompt` is the authored prompt text, from `prompt` or read from `prompt_file`. A stage with
/// neither has none, and the runner then uses its fallback line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stage {
    pub name: String,
    pub agent: String,
    pub prompt: Option<String>,
    pub prompt_file: Option<String>,
}

impl Workflow {
    /// The resolved workflow as JSON. Keys are sorted, nothing in it names a machine path, and the same workflow
    /// always gives the same bytes whatever order its keys had in the file.
    pub fn to_json(&self) -> Json {
        let mut root = Json::object();
        root.insert("format", Json::str(&self.format));
        root.insert("name", Json::str(&self.name));
        root.insert("version", Json::str(&self.version));

        let mut intent = Json::object();
        intent.insert("outcome", Json::str(&self.intent.outcome));
        let accept = self
            .intent
            .accept
            .iter()
            .map(|check| {
                let mut object = Json::object();
                object.insert("id", Json::str(&check.id));
                object.insert("file", Json::str(&check.file));
                object
            })
            .collect();
        intent.insert("accept", Json::Array(accept));
        root.insert("intent", intent);

        let mut params = Json::object();
        for (name, param) in &self.params {
            let mut object = Json::object();
            if let Some(description) = &param.description {
                object.insert("description", Json::str(description));
            }
            if let Some(default) = &param.default {
                object.insert("default", Json::str(default));
            }
            params.insert(name, object);
        }
        root.insert("params", params);

        let stages = self
            .stages
            .iter()
            .map(|stage| {
                let mut object = Json::object();
                object.insert("name", Json::str(&stage.name));
                object.insert("agent", Json::str(&stage.agent));
                if let Some(prompt) = &stage.prompt {
                    object.insert("prompt", Json::str(prompt));
                }
                if let Some(path) = &stage.prompt_file {
                    object.insert("prompt_file", Json::str(path));
                }
                object
            })
            .collect();
        root.insert("stages", Json::Array(stages));
        root
    }
}
