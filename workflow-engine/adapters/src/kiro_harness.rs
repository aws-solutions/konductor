// SPDX-License-Identifier: Apache-2.0
//! The `kiro-cli` harness: one headless Kiro CLI session for each agent stage (spec: "Harness invocation").
//!
//! The session is `kiro-cli chat --no-interactive --agent <id> <engine flag> [--trust-tools=<ids>] "<prompt>"`, started
//! in the project root through the [`ProcessLauncher`] port. Its final message is its standard output.
//!
//! **Engine (D16).** The agent file's shape decides it: `--v2` for a file with `allowedTools`, `--v3` for one with
//! `permissions.rules`. A file with neither or both is refused, and the run fails before its first stage.
//!
//! **Permissions (D19).** On V2 the agent file's `allowedTools` applies and the runner passes no `--trust-tools`,
//! because the flag has no effect on V2 (checked in step 1f-1). On V3 the runner passes `--trust-tools` with the V3 ids
//! of the tools in the agent's own allow list, which is the same list the trust summary shows, and nothing else. A rule
//! that has no exact id, such as one with a `match` scope, is left out, so the session gets less and never more. The
//! runner never passes `--trust-all-tools`.
//!
//! The trust re-check is not here. The runner puts `GuardedHarness` in front of this harness, so a session starts only
//! while the repo tool configuration is unchanged.

use workflow_core::limits::MAX_SESSION_OUTPUT_BYTES;
use workflow_core::ports::{
    AgentTools, Harness, Launch, LaunchEnd, ProcessGroup, ProcessLauncher, Session, SessionEnd,
    SessionOutcome,
};

use crate::agent_catalog::{FileAgentCatalog, KiroEngine};

/// The V3 id of a tool name from an agent's allow list. Each id was checked on Kiro CLI V3: `--trust-tools=<id>`
/// auto-approves that tool and no other (`shell` does not approve `write`, `write` does not approve `shell`, and
/// `fs_read` does not approve `shell`). Other V2 spellings of the same tools, such as `execute_bash`, are not in the
/// table, so a rule that uses one gets no id and the session gets less, never more.
const V3_IDS: &[(&str, &str)] = &[
    ("fs_read", "read"),
    ("fs_write", "write"),
    ("shell", "shell"),
];

/// The V3 ids for the tools of an allow list, in list order, each once. A name with no exact id is left out.
pub fn v3_trust_ids(allowed: &[String]) -> Vec<&'static str> {
    let mut ids: Vec<&'static str> = Vec::new();
    for name in allowed {
        if let Some((_, id)) = V3_IDS.iter().find(|(known, _)| known == name) {
            if !ids.contains(id) {
                ids.push(id);
            }
        }
    }
    ids
}

/// The arguments of `kiro-cli` for one stage.
pub fn kiro_args(agent: &str, engine: KiroEngine, allowed: &[String], prompt: &str) -> Vec<String> {
    let mut args = vec![
        "chat".to_string(),
        "--no-interactive".to_string(),
        "--agent".to_string(),
        agent.to_string(),
        engine.flag().to_string(),
    ];
    if engine == KiroEngine::V3 {
        let ids = v3_trust_ids(allowed);
        if !ids.is_empty() {
            args.push(format!("--trust-tools={}", ids.join(",")));
        }
    }
    args.push(prompt.to_string());
    args
}

/// Runs each stage in a headless Kiro CLI session.
pub struct KiroHarness<'a> {
    launcher: &'a mut dyn ProcessLauncher,
    catalog: &'a FileAgentCatalog,
    program: String,
    /// The folder a session starts in: the project root (D25).
    cwd: String,
    /// Told one line when a session does not end well, with the stage and why.
    note: Box<dyn FnMut(&str) + 'a>,
}

impl<'a> KiroHarness<'a> {
    /// `program` is `kiro-cli`, or the path of another program in a test. `catalog` must look where Kiro does: the
    /// project root and then the home folder.
    pub fn new(
        launcher: &'a mut dyn ProcessLauncher,
        catalog: &'a FileAgentCatalog,
        program: &str,
        cwd: &str,
        note: Box<dyn FnMut(&str) + 'a>,
    ) -> KiroHarness<'a> {
        KiroHarness {
            launcher,
            catalog,
            program: program.to_string(),
            cwd: cwd.to_string(),
            note,
        }
    }

    fn refuse(&mut self, stage: &str, why: &str) -> SessionOutcome {
        (self.note)(&format!("stage `{stage}` did not start: {why}"));
        SessionOutcome {
            end: SessionEnd::NotStarted,
            final_message: String::new(),
        }
    }
}

impl Harness for KiroHarness<'_> {
    fn run_session(&mut self, session: &Session) -> SessionOutcome {
        self.run_session_recorded(session, &mut |_| {})
    }

    fn run_session_recorded(
        &mut self,
        session: &Session,
        started: &mut dyn FnMut(&ProcessGroup),
    ) -> SessionOutcome {
        let Some(agent) = self.catalog.kiro_agent(session.agent) else {
            return self.refuse(
                session.stage,
                &format!("Kiro CLI cannot see the agent `{}`.", session.agent),
            );
        };
        let engine = match agent.engine {
            Ok(engine) => engine,
            Err(why) => return self.refuse(session.stage, &why),
        };
        let allowed: &[String] = match &agent.definition.tools {
            AgentTools::Listed(names) => names,
            _ => &[],
        };
        let args = kiro_args(session.agent, engine, allowed, session.prompt);
        let launched = self.launcher.launch(
            &Launch {
                program: &self.program,
                args: &args,
                cwd: &self.cwd,
                time_limit_ms: session.time_limit_ms,
                keep_output_bytes: MAX_SESSION_OUTPUT_BYTES,
            },
            started,
        );
        let stage = session.stage;
        let end = match launched.end {
            LaunchEnd::Exited(0) => SessionEnd::Exited(0),
            LaunchEnd::Exited(code) => {
                (self.note)(&format!(
                    "stage `{stage}`: the Kiro CLI session ended with exit status {code}."
                ));
                SessionEnd::Exited(code)
            }
            LaunchEnd::TimedOut => {
                (self.note)(&format!(
                    "stage `{stage}`: the Kiro CLI session passed its time limit and was stopped."
                ));
                SessionEnd::TimedOut
            }
            LaunchEnd::NotStarted(why) => {
                (self.note)(&format!(
                    "stage `{stage}`: the Kiro CLI session could not start: {why}"
                ));
                SessionEnd::NotStarted
            }
        };
        SessionOutcome {
            end,
            final_message: launched.output,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn v2_gets_the_engine_flag_and_no_trust_flag() {
        let args = kiro_args(
            "k-architect",
            KiroEngine::V2,
            &names(&["fs_read", "fs_write"]),
            "Goal: x",
        );
        assert_eq!(
            args,
            [
                "chat",
                "--no-interactive",
                "--agent",
                "k-architect",
                "--v2",
                "Goal: x"
            ]
        );
    }

    #[test]
    fn v3_gets_the_ids_of_its_allow_list_and_nothing_more() {
        let args = kiro_args(
            "k-architect",
            KiroEngine::V3,
            &names(&["fs_read", "fs_write", "shell"]),
            "Goal: x",
        );
        assert_eq!(
            args,
            [
                "chat",
                "--no-interactive",
                "--agent",
                "k-architect",
                "--v3",
                "--trust-tools=read,write,shell",
                "Goal: x"
            ]
        );
        assert!(!args.iter().any(|a| a.contains("trust-all-tools")));
    }

    #[test]
    fn v3_with_nothing_to_trust_passes_no_trust_flag() {
        for allowed in [
            names(&[]),
            names(&["mcp (aws-mcp/aws___search_documentation)"]),
            names(&["fs_write (src/*)"]),
        ] {
            let args = kiro_args("a", KiroEngine::V3, &allowed, "p");
            assert!(!args.iter().any(|a| a.starts_with("--trust")), "{args:?}");
        }
    }

    #[test]
    fn the_id_map_keeps_list_order_drops_repeats_and_leaves_out_unknown_names() {
        assert_eq!(
            v3_trust_ids(&names(&[
                "shell",
                "fs_read",
                "shell",
                "execute_bash",
                "use_aws",
                "*"
            ])),
            ["shell", "read"]
        );
        assert!(v3_trust_ids(&names(&["@builtin", "mcp (a/b)"])).is_empty());
    }

    #[test]
    fn the_prompt_is_one_argument_whatever_it_holds() {
        let prompt = "Goal: a b\n--trust-all-tools \"quoted\" $HOME";
        let args = kiro_args("a", KiroEngine::V3, &names(&["fs_write"]), prompt);
        assert_eq!(args.last().map(String::as_str), Some(prompt));
        assert_eq!(args.iter().filter(|a| a.contains("trust-all")).count(), 1);
    }
}
