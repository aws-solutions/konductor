// SPDX-License-Identifier: Apache-2.0
//! The `kiro-cli-acp` and `claude-acp` harnesses: one ACP adapter process for each agent stage.
//!
//! The adapter is `kiro-cli acp ...` or `claude-agent-acp`, started in the project root in its own process group by
//! [`SystemLauncher::spawn_piped`]. The conversation is in [`crate::acp_client`]. The stage prompt is sent as the
//! prompt of the session, as the CLI harnesses pass it as their argument, and the final message is the agent's
//! message text.
//!
//! **One adapter for each stage.** The adapter is ended with its group when the stage ends, on every path, so no
//! adapter runs between stages and the run state has the group only while a stage runs.
//!
//! **The agent.** The agent file is the one the catalog finds, the file the trust summary names. For Kiro the engine
//! is chosen by the file's shape as for `kiro-cli chat`: `--agent-engine v2` with `--agent <id>` for `allowedTools`,
//! and `--agent-engine v3` with the agent as the session mode for `permissions.rules`. For Claude the agent goes in
//! `session/new`, and only a definition in the project is used, because the adapter is told to read project settings
//! only. A session that does not report the named agent fails the stage. There is no default agent to fall back to.
//! The file is hashed before the adapter starts and after the stage ends, and a stage during which the adapter
//! rewrote it fails: the rules the stage ran with are then not the ones that were read and confirmed.
//!
//! **Permissions.** The allow rules are the ones the CLI harnesses use: Kiro's allow list, and the rules of a Claude
//! `tools` list. An unlisted tool, or a rule this build cannot read, allows nothing. A request that a Kiro adapter
//! sends is one that Kiro's own policy did not allow, and the harness answers it from the agent file alone.
//!
//! **Interrupts and standard error.** The launcher the harness is given may carry an interrupt flag, which the owner
//! sets on Ctrl-C, SIGTERM or SIGHUP. A session that starts after the flag was set starts nothing, and one that is
//! running ends at once, with no `session/cancel`: its group gets the terminate signal, the grace period and the kill,
//! as for the CLI harnesses. The last 4 KiB of the adapter's standard error go under a failure line through `note`, cut
//! to printable lines, and never into the outcome.
//!
//! The trust re-check is not here. The runner puts `GuardedHarness` in front of this harness.

use std::time::{Duration, Instant};

use workflow_core::limits::{KILL_GRACE_MS, MAX_SESSION_STDERR_BYTES};
use workflow_core::ports::{
    AgentCatalog, AgentTools, Harness, ProcessGroup, Runner, Session, SessionEnd, SessionOutcome,
};
use workflow_core::trust::plain;

use crate::acp_client::{converse, Adapter, Ending, Plan};
use crate::agent_catalog::{FileAgentCatalog, KiroEngine};
use crate::claude_harness::{tool_rules, ToolRules};
use crate::kiro_harness::with_stderr;
use crate::launcher::SystemLauncher;

/// Which adapter a harness starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcpKind {
    /// `kiro-cli acp`, the harness `kiro-cli-acp`.
    KiroCli,
    /// `claude-agent-acp`, the harness `claude-acp`.
    Claude,
}

impl AcpKind {
    /// What the notes call the adapter.
    fn label(self) -> &'static str {
        match self {
            AcpKind::KiroCli => "kiro-cli acp",
            AcpKind::Claude => "claude-agent-acp",
        }
    }
}

/// The arguments of `kiro-cli` for one stage. The agent is named here only for the V2 engine, which has the flag.
pub fn kiro_acp_args(agent: &str, engine: KiroEngine) -> Vec<String> {
    let mut args = vec!["acp".to_string()];
    if engine == KiroEngine::V2 {
        args.push("--agent".to_string());
        args.push(agent.to_string());
    }
    args.push("--agent-engine".to_string());
    args.push(
        match engine {
            KiroEngine::V2 => "v2",
            KiroEngine::V3 => "v3",
        }
        .to_string(),
    );
    args
}

/// What a session needs from its agent file.
struct Prepared {
    adapter: Adapter,
    args: Vec<String>,
    rules: Vec<String>,
    /// The agent file as the trust summary shows it.
    file: String,
}

/// `line` followed by the tail of the adapter's standard error, as `with_stderr` shows it. The launcher keeps the last
/// 4 KiB, so when the tail is that long the adapter wrote more than is shown, and the text says so.
fn with_errors(line: String, errors: &str) -> String {
    let shown = with_stderr(line, errors);
    let cut = errors.len() + 4 > MAX_SESSION_STDERR_BYTES;
    if cut && shown.contains("standard error:") {
        format!("{shown}\n  The adapter wrote more than 4 KiB to its standard error, so only the end is shown.")
    } else {
        shown
    }
}

/// Runs each stage in an ACP adapter.
pub struct AcpHarness<'a> {
    launcher: &'a SystemLauncher,
    catalog: &'a FileAgentCatalog,
    kind: AcpKind,
    program: String,
    /// The folder a session starts in: the project root.
    cwd: String,
    /// Told one line when a session does not end well, with the stage and why.
    note: Box<dyn FnMut(&str) + 'a>,
    /// A cap on the time limit of a session. Tests use a short one.
    limit_cap_ms: Option<u64>,
    /// How long the prompt gets to answer after `session/cancel`.
    cancel_grace: Duration,
}

impl<'a> AcpHarness<'a> {
    /// `program` is `kiro-cli` or `claude-agent-acp`, or the path of another program in a test. `catalog` must look
    /// where the adapter's agent does: for Kiro the project root and then the home folder, and for Claude the project
    /// root and the folders above it up to the git top folder.
    pub fn new(
        launcher: &'a SystemLauncher,
        catalog: &'a FileAgentCatalog,
        kind: AcpKind,
        program: &str,
        cwd: &str,
        note: Box<dyn FnMut(&str) + 'a>,
    ) -> AcpHarness<'a> {
        AcpHarness {
            launcher,
            catalog,
            kind,
            program: program.to_string(),
            cwd: cwd.to_string(),
            note,
            limit_cap_ms: None,
            cancel_grace: Duration::from_millis(KILL_GRACE_MS),
        }
    }

    /// Shortens the time limit of a session to `limit_ms` at most, and the wait after `session/cancel` to `grace_ms`.
    /// Only a test wants this: the runner's limit is 30 minutes and the wait is 10 seconds.
    pub fn with_test_limits(
        mut self,
        limit_ms: Option<u64>,
        grace_ms: Option<u64>,
    ) -> AcpHarness<'a> {
        self.limit_cap_ms = limit_ms;
        if let Some(ms) = grace_ms {
            self.cancel_grace = Duration::from_millis(ms);
        }
        self
    }

    fn refuse(&mut self, stage: &str, why: &str) -> SessionOutcome {
        (self.note)(&format!("stage `{stage}` did not start: {why}"));
        SessionOutcome {
            end: SessionEnd::NotStarted,
            final_message: String::new(),
        }
    }

    /// The adapter, its arguments and the allow rules for the agent of a session, or why the agent cannot run.
    fn prepare(&mut self, session: &Session) -> Result<Prepared, String> {
        let stage = session.stage;
        match self.kind {
            AcpKind::KiroCli => {
                let agent = self
                    .catalog
                    .kiro_agent(session.agent)
                    .ok_or_else(|| format!("Kiro CLI cannot see the agent `{}`.", session.agent))?;
                let engine = agent.engine?;
                let rules = match agent.definition.tools {
                    AgentTools::Listed(names) => {
                        // A name that starts with `-` could be read as a flag, and no real tool starts with one, so it
                        // allows nothing, as on the Claude harness.
                        for name in names.iter().filter(|name| name.starts_with('-')) {
                            (self.note)(&format!(
                                "stage `{stage}`: the tool `{}` in the allow list of `{}` starts with `-`, so it allows \
                                 nothing.",
                                plain(name),
                                plain(&agent.definition.file)
                            ));
                        }
                        names
                    }
                    AgentTools::EveryToolNonePreApproved => Vec::new(),
                    AgentTools::Unknown(why) => {
                        (self.note)(&format!(
                            "stage `{stage}`: no tool request is allowed for the session, because the allow rules of \
                             `{}` cannot be read: {why}.",
                            plain(&agent.definition.file)
                        ));
                        Vec::new()
                    }
                };
                let adapter = match engine {
                    KiroEngine::V2 => Adapter::KiroV2,
                    KiroEngine::V3 => Adapter::KiroV3,
                };
                Ok(Prepared {
                    adapter,
                    args: kiro_acp_args(session.agent, engine),
                    rules,
                    file: plain(&agent.definition.file),
                })
            }
            AcpKind::Claude => {
                let definition = self
                    .catalog
                    .definitions(session.agent)
                    .into_iter()
                    .find(|d| d.runner == Runner::Claude)
                    .ok_or_else(|| {
                        format!("Claude Code cannot see the agent `{}`.", session.agent)
                    })?;
                if definition.placement == workflow_core::ports::Placement::Home {
                    return Err(format!(
                        "the agent `{}` is defined in the home folder ({}). The `claude-acp` harness reads project \
                         settings only, so it runs agents that are defined in the project.",
                        session.agent,
                        plain(&definition.file)
                    ));
                }
                let rules = match tool_rules(&definition.tools) {
                    ToolRules::Rules(rules) => rules,
                    ToolRules::None => Vec::new(),
                    ToolRules::Unknown(why) => {
                        (self.note)(&format!(
                            "stage `{stage}`: no tool request is allowed for the session, because the allow rules of \
                             `{}` cannot be used: {why}.",
                            plain(&definition.file)
                        ));
                        Vec::new()
                    }
                };
                Ok(Prepared {
                    adapter: Adapter::Claude,
                    args: Vec::new(),
                    rules,
                    file: plain(&definition.file),
                })
            }
        }
    }
}

impl Harness for AcpHarness<'_> {
    fn run_session(&mut self, session: &Session) -> SessionOutcome {
        self.run_session_recorded(session, &mut |_| Ok(()))
    }

    fn run_session_recorded(
        &mut self,
        session: &Session,
        started: &mut dyn FnMut(&ProcessGroup) -> Result<(), String>,
    ) -> SessionOutcome {
        let stage = session.stage;
        // The hash is taken before the rules are read, so a change between the two reads is seen too.
        let runner = match self.kind {
            AcpKind::KiroCli => Runner::KiroCli,
            AcpKind::Claude => Runner::Claude,
        };
        let file_before = self.catalog.agent_file_hash(runner, session.agent);
        let Prepared {
            adapter,
            args,
            rules,
            file,
        } = match self.prepare(session) {
            Ok(prepared) => prepared,
            Err(why) => return self.refuse(stage, &why),
        };
        let label = self.kind.label();
        // An interrupt that came before this session starts keeps it from starting, as for the CLI harnesses.
        if self.launcher.interrupted() {
            (self.note)(&format!(
                "stage `{stage}`: the {label} session was stopped because the run was interrupted."
            ));
            return SessionOutcome {
                end: SessionEnd::Interrupted,
                final_message: String::new(),
            };
        }
        let limit_ms = self
            .limit_cap_ms
            .map_or(session.time_limit_ms, |cap| cap.min(session.time_limit_ms));
        // A limit too large to add to the clock is a limit that never comes.
        let limit = Instant::now()
            .checked_add(Duration::from_millis(limit_ms))
            .unwrap_or_else(|| Instant::now() + Duration::from_secs(365 * 24 * 3600));
        let mut process = match self.launcher.spawn_piped(
            &self.program,
            &args,
            &self.cwd,
            Duration::from_millis(limit_ms).saturating_add(self.cancel_grace),
            started,
        ) {
            Ok(process) => process,
            Err(why) => {
                (self.note)(&format!(
                    "stage `{stage}`: the {label} session could not start: {why}"
                ));
                return SessionOutcome {
                    end: SessionEnd::NotStarted,
                    final_message: String::new(),
                };
            }
        };
        let outcome = converse(
            process.wire(),
            &Plan {
                adapter,
                agent: session.agent,
                cwd: &self.cwd,
                prompt: session.prompt,
                rules: &rules,
                file: &file,
                limit,
                grace: self.cancel_grace,
            },
        );
        // The status is read before the group is ended, so it is the adapter's own and not that of the signal. Only a
        // failed conversation uses it, and an adapter that has just closed its output may need a moment to end.
        let exited = match outcome.ending {
            Ending::Closed(_) => process.exit_status(Duration::from_millis(500)),
            _ => None,
        };
        process.end();
        // The tail of the adapter's standard error goes under a failure line, for the terminal. It is the adapter's own
        // text, so `with_stderr` cuts it to printable lines, and it is never part of the outcome.
        let errors = process.errors();
        let file_after = self.catalog.agent_file_hash(runner, session.agent);
        let (mut end, final_message) = match outcome.ending {
            Ending::Completed => (SessionEnd::Exited(0), outcome.text),
            Ending::TimedOut => {
                (self.note)(&with_errors(
                    format!(
                        "stage `{stage}`: the {label} session passed its time limit and was stopped."
                    ),
                    &errors,
                ));
                (SessionEnd::TimedOut, outcome.text)
            }
            Ending::Interrupted => {
                (self.note)(&format!(
                    "stage `{stage}`: the {label} session was stopped because the run was interrupted."
                ));
                (SessionEnd::Interrupted, String::new())
            }
            Ending::Refused(why) => {
                (self.note)(&with_errors(
                    format!("stage `{stage}` did not start: {why}"),
                    &errors,
                ));
                (SessionEnd::NotStarted, String::new())
            }
            Ending::Failed(why) | Ending::Closed(why) => {
                let status =
                    exited.map_or_else(String::new, |code| format!(" (exit status {code})"));
                (self.note)(&with_errors(
                    format!("stage `{stage}`: the {label} session failed{status}: {why}."),
                    &errors,
                ));
                (
                    SessionEnd::Exited(exited.filter(|code| *code != 0).unwrap_or(1)),
                    outcome.text,
                )
            }
            Ending::Denied(why) => {
                (self.note)(&format!("stage `{stage}` is blocked: {why}."));
                (SessionEnd::Exited(1), outcome.text)
            }
        };
        if file_before != file_after {
            // The file is named as the trust summary shows it, with the reason: it is gone, or its content differs.
            let reason = if file_after.is_none() {
                "it is gone or cannot be read now"
            } else {
                "its content is not what was read before the stage"
            };
            (self.note)(&format!(
                "stage `{stage}`: the agent file `{file}` of `{}` changed while the stage ran ({reason}), so the {label} \
                 adapter rewrote it, and the stage ran with permissions that were not the ones confirmed.",
                plain(session.agent)
            ));
            if end == SessionEnd::Exited(0) {
                end = SessionEnd::Exited(1);
            }
        }
        SessionOutcome { end, final_message }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_long_standard_error_tail_says_that_only_the_end_is_shown() {
        let short = with_errors("line".to_string(), "one\ntwo\n");
        assert_eq!(
            short,
            "line\n  The session wrote this to its standard error:\n    one\n    two"
        );
        let long = "x".repeat(MAX_SESSION_STDERR_BYTES);
        let cut = with_errors("line".to_string(), &long);
        assert!(cut.ends_with("so only the end is shown."), "{cut}");
        // Nothing to show means no line about it either.
        assert_eq!(with_errors("line".to_string(), ""), "line");
        assert_eq!(
            with_errors("line".to_string(), &" \n".repeat(MAX_SESSION_STDERR_BYTES)),
            "line"
        );
    }

    #[test]
    fn a_v2_agent_is_named_on_the_command_line() {
        assert_eq!(
            kiro_acp_args("k-architect", KiroEngine::V2),
            ["acp", "--agent", "k-architect", "--agent-engine", "v2"]
        );
    }

    #[test]
    fn a_v3_agent_is_not_on_the_command_line_and_no_trust_flag_is_ever_passed() {
        let args = kiro_acp_args("k-architect", KiroEngine::V3);
        assert_eq!(args, ["acp", "--agent-engine", "v3"]);
        for engine in [KiroEngine::V2, KiroEngine::V3] {
            let all = kiro_acp_args("a", engine).join(" ");
            assert!(!all.contains("trust"), "{all}");
        }
    }
}
