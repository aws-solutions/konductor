// SPDX-License-Identifier: Apache-2.0
//! The `kiro-cli` harness: one headless Kiro CLI session for each agent stage (spec: "Harness invocation").
//!
//! The session is `kiro-cli chat --no-interactive --agent <id> <engine flag> "<prompt>"`, started
//! in the project root through the [`ProcessLauncher`] port. Its final message is its standard output.
//!
//! **Engine (D16).** The agent file's shape decides it: `--v2` for a file with `allowedTools`, `--v3` for one with
//! `permissions.rules`. A file with neither or both is refused, and the run fails before its first stage.
//!
//! **Permissions.** The runner passes no `--trust-tools` and never `--trust-all-tools`, on V2 or V3. What the session
//! may run without asking is what the agent file says: its `allowedTools` on V2, and its `allow` rules on V3. That is
//! the same list the trust summary shows, read from the same file, so nothing is approved that the user was not shown.
//!
//! **Standard error.** When a session fails, the last 4 KiB of its standard error are printed under the failure line,
//! through `note`, so the user can tell a login problem from a bad flag. They are cut to printable text and are never
//! part of the outcome, so they do not reach the run state. There is no redaction of secret-looking values: a program
//! that prints a secret to its standard error shows it on this terminal, as it would if it had been run there.
//!
//! The trust re-check is not here. The runner puts `GuardedHarness` in front of this harness, so a session starts only
//! while the repo tool configuration is unchanged.

use workflow_core::limits::MAX_SESSION_OUTPUT_BYTES;
use workflow_core::ports::{
    Harness, Launch, LaunchEnd, ProcessGroup, ProcessLauncher, Session, SessionEnd, SessionOutcome,
};
use workflow_core::trust::plain;

use crate::agent_catalog::{FileAgentCatalog, KiroEngine};

/// The arguments of `kiro-cli` for one stage. There is no `--trust-tools`: the agent file is the one place that says
/// what the session may run without asking.
pub fn kiro_args(agent: &str, engine: KiroEngine, prompt: &str) -> Vec<String> {
    vec![
        "chat".to_string(),
        "--no-interactive".to_string(),
        "--agent".to_string(),
        agent.to_string(),
        engine.flag().to_string(),
        prompt.to_string(),
    ]
}

/// `line` followed by the tail of the session's standard error, each of its lines indented and cut to printable text.
/// The tail starts wherever the 4 KiB cut fell, so its first line can be partial.
fn with_stderr(line: String, errors: &str) -> String {
    let shown: Vec<String> = errors
        .lines()
        .map(|l| plain(l.trim_end()))
        .filter(|l| !l.trim().is_empty())
        .collect();
    if shown.is_empty() {
        return line;
    }
    let mut text = format!("{line}\n  The session wrote this to its standard error:");
    for l in shown {
        text.push_str("\n    ");
        text.push_str(&l);
    }
    text
}

/// Runs each stage in a headless Kiro CLI session.
pub struct KiroHarness<'a> {
    launcher: &'a mut dyn ProcessLauncher,
    catalog: &'a FileAgentCatalog,
    program: String,
    /// The folder a session starts in: the project root (D25).
    cwd: String,
    /// Told when a session does not end well: one line with the stage and why, and under it the tail of the session's
    /// standard error, if it printed any. It is for the terminal and is not part of the run state.
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
        self.run_session_recorded(session, &mut |_| Ok(()))
    }

    fn run_session_recorded(
        &mut self,
        session: &Session,
        started: &mut dyn FnMut(&ProcessGroup) -> Result<(), String>,
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
        let args = kiro_args(session.agent, engine, session.prompt);
        let launched = self.launcher.launch(
            &Launch {
                program: &self.program,
                args: &args,
                cwd: &self.cwd,
                time_limit_ms: session.time_limit_ms,
                keep_output_bytes: MAX_SESSION_OUTPUT_BYTES,
                keep_head_bytes: 0,
            },
            started,
        );
        let stage = session.stage;
        let end = match launched.end {
            LaunchEnd::Exited(0) => SessionEnd::Exited(0),
            LaunchEnd::Exited(code) => {
                (self.note)(&with_stderr(
                    format!("stage `{stage}`: the Kiro CLI session ended with exit status {code}."),
                    &launched.errors,
                ));
                SessionEnd::Exited(code)
            }
            LaunchEnd::TimedOut => {
                (self.note)(&with_stderr(
                    format!(
                        "stage `{stage}`: the Kiro CLI session passed its time limit and was stopped."
                    ),
                    &launched.errors,
                ));
                SessionEnd::TimedOut
            }
            LaunchEnd::Interrupted => {
                (self.note)(&format!(
                    "stage `{stage}`: the Kiro CLI session was stopped because the run was interrupted."
                ));
                SessionEnd::Interrupted
            }
            LaunchEnd::NotStarted(why) => {
                (self.note)(&with_stderr(
                    format!("stage `{stage}`: the Kiro CLI session could not start: {why}"),
                    &launched.errors,
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

    #[test]
    fn v2_gets_the_engine_flag_and_no_trust_flag() {
        let args = kiro_args("k-architect", KiroEngine::V2, "Goal: x");
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
    fn v3_gets_the_engine_flag_and_no_trust_flag() {
        let args = kiro_args("k-architect", KiroEngine::V3, "Goal: x");
        assert_eq!(
            args,
            [
                "chat",
                "--no-interactive",
                "--agent",
                "k-architect",
                "--v3",
                "Goal: x"
            ]
        );
    }

    #[test]
    fn the_prompt_is_one_argument_whatever_it_holds() {
        let prompt = "Goal: a b\n--trust-all-tools \"quoted\" $HOME";
        let args = kiro_args("a", KiroEngine::V3, prompt);
        assert_eq!(args.last().map(String::as_str), Some(prompt));
        assert_eq!(args.iter().filter(|a| a.contains("trust-all")).count(), 1);
    }
}
