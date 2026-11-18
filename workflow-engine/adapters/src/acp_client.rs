// SPDX-License-Identifier: Apache-2.0
//! The client side of one ACP v1 conversation: `initialize`, `session/new`, `session/prompt`, and the updates and
//! permission requests the adapter sends while it works. The adapter's two ends are behind [`Wire`], so the whole
//! conversation runs in a unit test with no process.
//!
//! **One conversation is one stage.** It starts a session, sends the stage prompt as one text block and reads until
//! the prompt is answered. The runner keeps no adapter between stages.
//!
//! **Text.** The agent's message is the text of its `agent_message_chunk` updates, in order. Reasoning, tool updates
//! and every other update are dropped: updates are display data and never evidence. The last
//! [`MAX_SESSION_OUTPUT_BYTES`] of the text are kept. A message that follows a tool call, or has another message id
//! than the one before it, starts on a new line, so a result line is never glued to the text before it.
//!
//! **Choosing the agent.** The session must run as the agent the stage names, and the answer to `session/new` has to
//! say so. If it does not, the stage fails and no other agent runs. Claude's adapter also starts in a permission mode
//! that allows tools without asking, so the client sets mode `default` and the stage fails unless the adapter
//! confirms it, or if the adapter later changes the mode. It reads only the project's settings files
//! (`settingSources`), because the user's settings and the local settings can hold allow rules that the agent file
//! does not.
//!
//! **Permissions.** Each `session/request_permission` is answered by [`decide`] from the allow rules of the agent
//! file. A refusal ends the conversation at once, with the tool in the result.
//!
//! **The adapter's own requests.** A request from the adapter is answered with the id it came with, so the id must be
//! a number or a short string. Permission requests are the normal way a tool is approved and are bounded by the time
//! limit, so they are not counted. A stage serves at most [`MAX_ADAPTER_REQUESTS`] other requests. A permission
//! request for another session fails the stage.
//!
//! **Interrupts.** When the wire reports an interrupt the conversation ends at once, with no `session/cancel`, and the
//! caller ends the adapter's process group.
//!
//! **Time.** Every wait has a deadline, and the deadline is checked before each frame is read, so an adapter that keeps
//! talking cannot extend it. At the time limit the client sends `session/cancel`, then waits up to the grace period
//! for the prompt to be answered, and ends the conversation as timed out either way. The caller then ends the
//! adapter's process group.

use std::time::{Duration, Instant};

use workflow_core::json::{self, Json};
use workflow_core::limits::MAX_SESSION_OUTPUT_BYTES;
use workflow_core::runner::keep_tail;
use workflow_core::trust::plain;

use crate::acp_permission::{decide, Decision, Refusal, Request};

/// The one protocol version this client speaks.
pub const PROTOCOL_VERSION: u64 = 1;

/// How many requests other than permission requests the adapter may send in one stage. Every one of them is answered
/// with an error, and a real adapter sends none.
pub const MAX_ADAPTER_REQUESTS: usize = 1000;

/// The longest id of an adapter's request, in bytes. JSON-RPC ids are numbers or short strings, and the answer carries
/// the id back.
pub const MAX_REQUEST_ID_BYTES: usize = 256;

/// How the adapter and its agent are told apart. It decides how the agent is chosen and how permissions are held down.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Adapter {
    /// `claude-agent-acp`: the agent goes in `session/new`, and the mode is set to `default`.
    Claude,
    /// `kiro-cli acp --agent <id> --agent-engine v2`: the agent is on the command line.
    KiroV2,
    /// `kiro-cli acp --agent-engine v3`: the agent is the session mode named in `session/new`.
    KiroV3,
}

/// What one frame read from the adapter was, or why there is none.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Incoming {
    Frame(String),
    /// A frame over the size limit.
    TooLong,
    NotUtf8,
    /// The adapter closed its output.
    Closed,
    /// The adapter could not be read or written. The text says why.
    Failed(String),
    /// The deadline passed with no frame.
    TimedOut,
}

/// The two ends of the conversation.
pub trait Wire {
    /// Queues one frame for the adapter. It never waits for the adapter to read it.
    fn send(&mut self, frame: &str) -> Result<(), String>;
    /// The next frame, or what ended the wait, no later than `until`.
    fn recv(&mut self, until: Instant) -> Incoming;
    /// Whether the owner was interrupted (Ctrl-C, SIGTERM or SIGHUP), so the conversation has to end now.
    fn interrupted(&self) -> bool {
        false
    }
}

/// What one conversation is to do.
#[derive(Debug, Clone)]
pub struct Plan<'a> {
    pub adapter: Adapter,
    pub agent: &'a str,
    /// The folder the session starts in: the project root.
    pub cwd: &'a str,
    pub prompt: &'a str,
    /// The allow rules of the agent file.
    pub rules: &'a [String],
    /// The agent file as the trust summary shows it, so that a refusal can name the file whose rules decided it.
    pub file: &'a str,
    /// When the time limit ends.
    pub limit: Instant,
    /// How long the prompt gets to answer after `session/cancel`.
    pub grace: Duration,
}

/// How a conversation ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ending {
    /// The turn ended with `end_turn`.
    Completed,
    /// The time limit passed.
    TimedOut,
    /// The owner was interrupted, and the conversation ended without a cancel.
    Interrupted,
    /// The adapter cannot be used, and no session was started. The text says why.
    Refused(String),
    /// The conversation went wrong. The text says what.
    Failed(String),
    /// The adapter closed its output before the conversation was over. The text says where.
    Closed(String),
    /// A permission request was refused. The text names the tool.
    Denied(String),
}

/// The end of a conversation and the message text read until then.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub ending: Ending,
    pub text: String,
}

enum Stop {
    Time,
    Interrupted,
    Refused(String),
    Failed(String),
    Closed(String),
    Denied(String),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Setup,
    Prompt,
    Cancelling,
}

/// Runs one conversation to its end.
pub fn converse(wire: &mut dyn Wire, plan: &Plan) -> Outcome {
    let mut talk = Talk {
        wire,
        plan,
        message: Message::default(),
        next_id: 0,
        session: None,
        mode: None,
        mode_held: false,
        requests: 0,
    };
    let ending = match talk.run() {
        Ok(()) => Ending::Completed,
        Err(Stop::Time) => Ending::TimedOut,
        Err(Stop::Interrupted) => Ending::Interrupted,
        Err(Stop::Refused(why)) => Ending::Refused(why),
        Err(Stop::Failed(why)) => Ending::Failed(why),
        Err(Stop::Closed(why)) => Ending::Closed(why),
        Err(Stop::Denied(why)) => Ending::Denied(why),
    };
    // A stage that is blocked by a refusal has no message that anything reads.
    let text = match ending {
        Ending::Denied(_) => String::new(),
        _ => talk.message.finish(),
    };
    Outcome { ending, text }
}

struct Talk<'a, 'p> {
    wire: &'a mut dyn Wire,
    plan: &'a Plan<'p>,
    message: Message,
    next_id: u64,
    session: Option<String>,
    /// The mode that the last `current_mode_update` named.
    mode: Option<String>,
    /// Set once the adapter confirmed the mode `default`: from then on any other mode fails the stage.
    mode_held: bool,
    /// How many requests the adapter has sent.
    requests: usize,
}

impl Talk<'_, '_> {
    fn run(&mut self) -> Result<(), Stop> {
        let plan = self.plan;
        let reply = self.call("initialize", initialize_params(), Phase::Setup)?;
        let version = reply.get("protocolVersion").and_then(Json::as_u64);
        if version != Some(PROTOCOL_VERSION) {
            let said = version.map_or_else(|| "no version".to_string(), |v| format!("version {v}"));
            return Err(Stop::Refused(format!(
                "the adapter answered with ACP {said}. This build speaks ACP version {PROTOCOL_VERSION} only."
            )));
        }
        let reply = self.call(
            "session/new",
            new_session_params(plan.adapter, plan.agent, plan.cwd),
            Phase::Setup,
        )?;
        let session = reply
            .get("sessionId")
            .and_then(Json::as_str)
            .ok_or_else(|| {
                Stop::Failed("the adapter answered `session/new` with no session id".to_string())
            })?
            .to_string();
        self.session = Some(session.clone());
        self.check_agent(&reply)?;
        if plan.adapter == Adapter::Claude {
            self.hold_mode_default(&session)?;
        }
        let reply = self.prompt(&session)?;
        match reply.get("stopReason").and_then(Json::as_str) {
            Some("end_turn") => Ok(()),
            Some(other) => Err(Stop::Failed(format!(
                "the turn ended with the stop reason `{}`",
                plain(other)
            ))),
            None => Err(Stop::Failed(
                "the adapter answered `session/prompt` with no stop reason".to_string(),
            )),
        }
    }

    /// The answer to `session/new` has to say that the stage's agent is the one that runs.
    fn check_agent(&self, reply: &Json) -> Result<(), Stop> {
        let agent = self.plan.agent;
        let selected = match self.plan.adapter {
            Adapter::Claude => config_value(reply, "agent"),
            Adapter::KiroV2 | Adapter::KiroV3 => reply
                .get("modes")
                .and_then(|modes| modes.get("currentModeId"))
                .and_then(Json::as_str)
                .or_else(|| {
                    reply
                        .get("_meta")
                        .and_then(|meta| meta.get("agentMode"))
                        .and_then(Json::as_str)
                }),
        };
        if selected == Some(agent) {
            return Ok(());
        }
        Err(Stop::Failed(format!(
            "the adapter did not start the agent `{agent}`: it reports {}, and no other agent is used",
            selected.map_or_else(|| "no agent".to_string(), |s| format!("`{}`", plain(s)))
        )))
    }

    /// Sets the permission mode `default` and requires the adapter to confirm it, in the answer or in an update.
    fn hold_mode_default(&mut self, session: &str) -> Result<(), Stop> {
        let reply = self.call(
            "session/set_config_option",
            set_config_params(session, "mode", "default"),
            Phase::Setup,
        )?;
        // The answer is authoritative when it names a mode. An update is used only when it does not.
        let confirmed = match config_value(&reply, "mode") {
            Some(mode) => mode == "default",
            None => self.mode.as_deref() == Some("default"),
        };
        if confirmed {
            self.mode_held = true;
            self.mode = Some("default".to_string());
            Ok(())
        } else {
            Err(Stop::Failed(
                "the adapter did not confirm the permission mode `default`, and a stage never runs in another mode"
                    .to_string(),
            ))
        }
    }

    fn prompt(&mut self, session: &str) -> Result<Json, Stop> {
        let id = self.send("session/prompt", prompt_params(session, self.plan.prompt))?;
        match self.wait(id, "session/prompt", self.plan.limit, Phase::Prompt) {
            Err(Stop::Time) => {
                // The notification is the polite end. Whatever the adapter does with it, the stage has timed out.
                self.cancel_and_wait(session, id);
                Err(Stop::Time)
            }
            Err(Stop::Denied(why)) => {
                // The refusal ends the stage. The adapter is told to stop and gets the grace period to say so.
                self.cancel_and_wait(session, id);
                Err(Stop::Denied(why))
            }
            other => other,
        }
    }

    /// Sends `session/cancel` and waits up to the grace period for the prompt to be answered. What the adapter says in
    /// that time, and whether it answers, changes nothing: the caller already knows how the conversation ends.
    fn cancel_and_wait(&mut self, session: &str, prompt_id: u64) {
        let _ = self
            .wire
            .send(&notification("session/cancel", cancel_params(session)));
        let until = Instant::now() + self.plan.grace;
        let _ = self.wait(prompt_id, "session/prompt", until, Phase::Cancelling);
    }

    fn call(&mut self, method: &str, params: Json, phase: Phase) -> Result<Json, Stop> {
        let id = self.send(method, params)?;
        self.wait(id, method, self.plan.limit, phase)
    }

    fn send(&mut self, method: &str, params: Json) -> Result<u64, Stop> {
        self.next_id += 1;
        let id = self.next_id;
        self.wire
            .send(&request(id, method, params))
            .map_err(|why| Stop::Failed(format!("could not write to the adapter: {why}")))?;
        Ok(id)
    }

    /// Reads frames until the response to request `id` arrives, answering what the adapter asks on the way. Returns the
    /// `result` of the response.
    fn wait(&mut self, id: u64, method: &str, until: Instant, phase: Phase) -> Result<Json, Stop> {
        loop {
            // An interrupt ends the conversation at once: the caller ends the adapter's group, as the launcher does for
            // the other harnesses, and the adapter gets no cancel.
            if self.wire.interrupted() {
                return Err(Stop::Interrupted);
            }
            // A frame that is already queued is returned even when the deadline has passed, so the deadline is checked
            // here, or an adapter that never stops talking would hold the stage open.
            if Instant::now() >= until {
                return Err(Stop::Time);
            }
            let frame = match self.wire.recv(until) {
                Incoming::Frame(frame) => frame,
                // A wait that was cut short by an interrupt is an interrupt, and not the end of the time.
                Incoming::TimedOut if self.wire.interrupted() => return Err(Stop::Interrupted),
                Incoming::TimedOut => return Err(Stop::Time),
                Incoming::TooLong => {
                    return Err(Stop::Failed(format!(
                        "the adapter sent a frame over the {} byte limit",
                        crate::acp_frames::MAX_FRAME_BYTES
                    )))
                }
                Incoming::NotUtf8 => {
                    return Err(Stop::Failed(
                        "the adapter sent a frame that is not UTF-8".to_string(),
                    ))
                }
                Incoming::Closed => {
                    return Err(Stop::Closed(format!(
                        "the adapter ended its output before it answered `{method}`"
                    )))
                }
                Incoming::Failed(why) => {
                    return Err(Stop::Failed(format!(
                        "the adapter could not be read: {why}"
                    )))
                }
            };
            let message = json::parse(&frame).map_err(|_| {
                Stop::Failed("the adapter sent a frame that is not JSON".to_string())
            })?;
            if !matches!(message, Json::Object(_)) {
                return Err(Stop::Failed(
                    "the adapter sent a frame that is not a JSON object".to_string(),
                ));
            }
            match (
                message.get("method").and_then(Json::as_str),
                message.get("id"),
            ) {
                (Some(called), Some(call_id)) => {
                    self.admit_call(called, call_id)?;
                    self.answer_call(called, call_id, &message, phase)?
                }
                (Some(notified), None) => {
                    self.take_notification(notified, &message);
                    self.check_mode()?;
                }
                (None, Some(reply_id)) => {
                    if *reply_id != Json::Number(id) {
                        return Err(Stop::Failed(format!(
                            "the adapter answered with the id {} while `{method}` had the id {id}",
                            plain(&reply_id.compact())
                        )));
                    }
                    if let Some(error) = message.get("error") {
                        return Err(Stop::Failed(format!(
                            "the adapter answered `{method}` with an error: {}",
                            describe_error(error)
                        )));
                    }
                    return message.get("result").cloned().ok_or_else(|| {
                        Stop::Failed(format!("the adapter answered `{method}` with no result"))
                    });
                }
                (None, None) => {
                    return Err(Stop::Failed(
                        "the adapter sent a frame that is no request, notification or response"
                            .to_string(),
                    ))
                }
            }
        }
    }

    /// Counts a request of the adapter that is not a permission request, and refuses an id that is not a number or a
    /// short string.
    fn admit_call(&mut self, method: &str, id: &Json) -> Result<(), Stop> {
        if method != "session/request_permission" {
            self.requests += 1;
        }
        if self.requests > MAX_ADAPTER_REQUESTS {
            return Err(Stop::Failed(format!(
                "the adapter sent more than {MAX_ADAPTER_REQUESTS} requests of its own in one stage"
            )));
        }
        let fits = match id {
            Json::Number(_) => true,
            Json::OtherNumber(text) | Json::Str(text) => text.len() <= MAX_REQUEST_ID_BYTES,
            _ => false,
        };
        if fits {
            Ok(())
        } else {
            Err(Stop::Failed(format!(
                "the adapter sent a request whose id is not a number or a string of at most {MAX_REQUEST_ID_BYTES} bytes"
            )))
        }
    }

    /// Fails the stage when the adapter has left the permission mode `default`.
    fn check_mode(&self) -> Result<(), Stop> {
        match self.mode.as_deref() {
            Some(mode) if self.mode_held && mode != "default" => Err(Stop::Failed(format!(
                "the adapter changed the permission mode to `{}`, and a stage never runs in another mode",
                plain(mode)
            ))),
            _ => Ok(()),
        }
    }

    /// A request from the adapter. Only a permission request is served.
    fn answer_call(
        &mut self,
        method: &str,
        id: &Json,
        message: &Json,
        phase: Phase,
    ) -> Result<(), Stop> {
        if method != "session/request_permission" {
            return self.reply(&error_response(id, 32601, "method not found"));
        }
        if phase != Phase::Prompt {
            return self.reply(&cancelled_response(id));
        }
        let params = message.get("params").unwrap_or(&Json::Null);
        // A request for another session is not decided by the rules of this stage.
        if let (Some(ours), Some(theirs)) = (self.session.as_deref(), params.get("sessionId")) {
            if theirs.as_str() != Some(ours) {
                let _ = self.reply(&cancelled_response(id));
                return Err(Stop::Failed(
                    "the adapter asked for permission for another session".to_string(),
                ));
            }
        }
        let request = Request::from_params(params);
        match decide(self.plan.rules, &request) {
            Decision::Allow(option) => self.reply(&selected_response(id, &option)),
            Decision::Deny { option, why } => {
                let answer = match option {
                    Some(option) => selected_response(id, &option),
                    None => cancelled_response(id),
                };
                let _ = self.reply(&answer);
                Err(Stop::Denied(match why {
                    Refusal::NoRule => format!(
                        "the agent asked to use `{}`, and no allow rule in the agent file `{}` names it",
                        request.label,
                        plain(self.plan.file)
                    ),
                    Refusal::NoOneTimeOption => format!(
                        "the agent asked to use `{}`, which the agent file `{}` allows, but the adapter offers no \
                         option to allow it once",
                        request.label,
                        plain(self.plan.file)
                    ),
                }))
            }
        }
    }

    fn reply(&mut self, frame: &str) -> Result<(), Stop> {
        self.wire
            .send(frame)
            .map_err(|why| Stop::Failed(format!("could not write to the adapter: {why}")))
    }

    fn take_notification(&mut self, method: &str, message: &Json) {
        if method != "session/update" {
            return;
        }
        let Some(params) = message.get("params") else {
            return;
        };
        // An update for another session is not this stage's.
        if let (Some(ours), Some(theirs)) = (
            self.session.as_deref(),
            params.get("sessionId").and_then(Json::as_str),
        ) {
            if ours != theirs {
                return;
            }
        }
        let Some(update) = params.get("update") else {
            return;
        };
        match update.get("sessionUpdate").and_then(Json::as_str) {
            Some("agent_message_chunk") => {
                let content = update.get("content");
                if content.and_then(|c| c.get("type")).and_then(Json::as_str) == Some("text") {
                    if let Some(text) = content.and_then(|c| c.get("text")).and_then(Json::as_str) {
                        let id = update.get("messageId").and_then(Json::as_str);
                        self.message.chunk(text, id);
                    }
                }
            }
            Some("tool_call") => self.message.break_line(),
            Some("current_mode_update") => {
                if let Some(mode) = update.get("currentModeId").and_then(Json::as_str) {
                    self.mode = Some(mode.to_string());
                }
            }
            Some("config_option_update") => {
                if let Some(mode) = config_value(update, "mode") {
                    self.mode = Some(mode.to_string());
                }
            }
            _ => {}
        }
    }
}

/// The agent's message text, the last [`MAX_SESSION_OUTPUT_BYTES`] of it.
#[derive(Default)]
struct Message {
    text: String,
    last_id: Option<String>,
    break_next: bool,
}

impl Message {
    fn chunk(&mut self, text: &str, id: Option<&str>) {
        let new_message =
            matches!((id, self.last_id.as_deref()), (Some(now), Some(before)) if now != before);
        if (new_message || self.break_next) && !self.text.is_empty() && !self.text.ends_with('\n') {
            self.text.push('\n');
        }
        self.break_next = false;
        if id.is_some() {
            self.last_id = id.map(str::to_string);
        }
        self.text.push_str(text);
        // Cut only when twice the limit is held, so each byte is moved a few times at most.
        if self.text.len() > MAX_SESSION_OUTPUT_BYTES.saturating_mul(2) {
            self.text = keep_tail(&self.text, MAX_SESSION_OUTPUT_BYTES).to_string();
        }
    }

    fn break_line(&mut self) {
        self.break_next = true;
    }

    fn finish(self) -> String {
        keep_tail(&self.text, MAX_SESSION_OUTPUT_BYTES).to_string()
    }
}

/// The `currentValue` of the config option `id` in a `configOptions` list.
fn config_value<'a>(reply: &'a Json, id: &str) -> Option<&'a str> {
    reply
        .get("configOptions")?
        .as_array()?
        .iter()
        .find(|option| option.get("id").and_then(Json::as_str) == Some(id))?
        .get("currentValue")?
        .as_str()
}

fn describe_error(error: &Json) -> String {
    let code = error.get("code").map(|c| c.compact()).unwrap_or_default();
    let message = error
        .get("message")
        .and_then(Json::as_str)
        .unwrap_or("no message");
    plain(&format!("{code} {message}")).trim().to_string()
}

fn object(entries: Vec<(&str, Json)>) -> Json {
    let mut value = Json::object();
    for (key, entry) in entries {
        value.insert(key, entry);
    }
    value
}

fn text(value: &str) -> Json {
    Json::str(value)
}

/// `initialize`: version 1, no client capability, so the adapter asks for no file or terminal.
pub fn initialize_params() -> Json {
    object(vec![
        ("protocolVersion", Json::Number(PROTOCOL_VERSION)),
        ("clientCapabilities", Json::object()),
        (
            "clientInfo",
            object(vec![
                ("name", text("konductor")),
                ("version", text(env!("CARGO_PKG_VERSION"))),
            ]),
        ),
    ])
}

/// `session/new` in `cwd`, with no MCP server of the client and the adapter's own way to name the agent.
pub fn new_session_params(adapter: Adapter, agent: &str, cwd: &str) -> Json {
    let mut params = object(vec![
        ("cwd", text(cwd)),
        ("mcpServers", Json::Array(Vec::new())),
    ]);
    let meta = match adapter {
        Adapter::Claude => Some(object(vec![(
            "claudeCode",
            object(vec![(
                "options",
                object(vec![
                    ("agent", text(agent)),
                    // Not the user's settings and not the local ones: the agent file is the one source of allow rules.
                    ("settingSources", Json::Array(vec![text("project")])),
                ]),
            )]),
        )])),
        Adapter::KiroV3 => Some(object(vec![(
            "kiro",
            object(vec![("modeId", text(agent))]),
        )])),
        Adapter::KiroV2 => None,
    };
    if let Some(meta) = meta {
        params.insert("_meta", meta);
    }
    params
}

pub fn set_config_params(session: &str, option: &str, value: &str) -> Json {
    object(vec![
        ("sessionId", text(session)),
        ("configId", text(option)),
        ("value", text(value)),
    ])
}

/// `session/prompt`: the stage prompt as one text block.
pub fn prompt_params(session: &str, prompt: &str) -> Json {
    object(vec![
        ("sessionId", text(session)),
        (
            "prompt",
            Json::Array(vec![object(vec![
                ("type", text("text")),
                ("text", text(prompt)),
            ])]),
        ),
    ])
}

pub fn cancel_params(session: &str) -> Json {
    object(vec![("sessionId", text(session))])
}

/// A request frame.
pub fn request(id: u64, method: &str, params: Json) -> String {
    object(vec![
        ("jsonrpc", text("2.0")),
        ("id", Json::Number(id)),
        ("method", text(method)),
        ("params", params),
    ])
    .compact()
}

/// A notification frame: a request with no id, so no answer comes.
pub fn notification(method: &str, params: Json) -> String {
    object(vec![
        ("jsonrpc", text("2.0")),
        ("method", text(method)),
        ("params", params),
    ])
    .compact()
}

fn response(id: &Json, result: Json) -> String {
    object(vec![
        ("jsonrpc", text("2.0")),
        ("id", id.clone()),
        ("result", result),
    ])
    .compact()
}

/// The answer to a permission request that chooses the option `option`.
pub fn selected_response(id: &Json, option: &str) -> String {
    response(
        id,
        object(vec![(
            "outcome",
            object(vec![
                ("outcome", text("selected")),
                ("optionId", text(option)),
            ]),
        )]),
    )
}

/// The answer to a permission request that chooses nothing.
pub fn cancelled_response(id: &Json) -> String {
    response(
        id,
        object(vec![(
            "outcome",
            object(vec![("outcome", text("cancelled"))]),
        )]),
    )
}

fn error_response(id: &Json, code: u64, message: &str) -> String {
    // JSON-RPC codes are negative, and the engine's JSON value holds whole numbers from 0 up, so the code is a
    // number that was read from text.
    object(vec![
        ("jsonrpc", text("2.0")),
        ("id", id.clone()),
        (
            "error",
            object(vec![
                ("code", Json::OtherNumber(format!("-{code}"))),
                ("message", text(message)),
            ]),
        ),
    ])
    .compact()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    /// A wire that answers each request from a script: `answer` is given the frame that was sent and returns the
    /// frames the adapter sends back.
    struct Script<F: FnMut(&Json) -> Vec<Incoming>> {
        answer: F,
        queue: VecDeque<Incoming>,
        sent: Vec<String>,
    }

    impl<F: FnMut(&Json) -> Vec<Incoming>> Script<F> {
        fn new(answer: F) -> Self {
            Script {
                answer,
                queue: VecDeque::new(),
                sent: Vec::new(),
            }
        }
    }

    impl<F: FnMut(&Json) -> Vec<Incoming>> Wire for Script<F> {
        fn send(&mut self, frame: &str) -> Result<(), String> {
            self.sent.push(frame.to_string());
            let sent = json::parse(frame).unwrap();
            self.queue.extend((self.answer)(&sent));
            Ok(())
        }

        fn recv(&mut self, _until: Instant) -> Incoming {
            self.queue.pop_front().unwrap_or(Incoming::TimedOut)
        }
    }

    fn frame(text: &str) -> Incoming {
        Incoming::Frame(text.to_string())
    }

    fn plan<'a>(adapter: Adapter, rules: &'a [String]) -> Plan<'a> {
        Plan {
            adapter,
            agent: "k-a",
            cwd: "/p",
            prompt: "Goal: x",
            rules,
            file: ".kiro/agents/k-a.json",
            limit: Instant::now() + Duration::from_secs(60),
            grace: Duration::from_millis(5),
        }
    }

    fn method(sent: &Json) -> &str {
        sent.get("method").and_then(Json::as_str).unwrap_or("")
    }

    fn id(sent: &Json) -> u64 {
        sent.get("id").and_then(Json::as_u64).unwrap_or(0)
    }

    fn chunk(text: &str) -> Incoming {
        frame(&format!(
            r#"{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"s1","update":{{"sessionUpdate":"agent_message_chunk","content":{{"type":"text","text":{}}}}}}}}}"#,
            Json::str(text).compact()
        ))
    }

    /// A Kiro adapter that answers the three calls and streams `chunks` before the end of the turn.
    fn kiro(chunks: Vec<Incoming>) -> impl FnMut(&Json) -> Vec<Incoming> {
        let mut chunks = Some(chunks);
        move |sent| {
            let n = id(sent);
            match method(sent) {
                "initialize" => vec![frame(&format!(
                    r#"{{"jsonrpc":"2.0","id":{n},"result":{{"protocolVersion":1}}}}"#
                ))],
                "session/new" => vec![frame(&format!(
                    r#"{{"jsonrpc":"2.0","id":{n},"result":{{"sessionId":"s1","modes":{{"currentModeId":"k-a"}}}}}}"#
                ))],
                "session/prompt" => {
                    let mut out = chunks.take().unwrap_or_default();
                    out.push(frame(&format!(
                        r#"{{"jsonrpc":"2.0","id":{n},"result":{{"stopReason":"end_turn"}}}}"#
                    )));
                    out
                }
                _ => Vec::new(),
            }
        }
    }

    #[test]
    fn the_frames_of_a_kiro_v2_conversation_are_these() {
        let mut wire = Script::new(kiro(vec![chunk("hello")]));
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &[]));
        assert_eq!(
            outcome,
            Outcome {
                ending: Ending::Completed,
                text: "hello".to_string()
            }
        );
        assert_eq!(
            wire.sent,
            [
                &format!(
                    r#"{{"id":1,"jsonrpc":"2.0","method":"initialize","params":{{"clientCapabilities":{{}},"clientInfo":{{"name":"konductor","version":"{}"}},"protocolVersion":1}}}}"#,
                    env!("CARGO_PKG_VERSION")
                ),
                r#"{"id":2,"jsonrpc":"2.0","method":"session/new","params":{"cwd":"/p","mcpServers":[]}}"#,
                r#"{"id":3,"jsonrpc":"2.0","method":"session/prompt","params":{"prompt":[{"text":"Goal: x","type":"text"}],"sessionId":"s1"}}"#,
            ]
        );
    }

    #[test]
    fn kiro_v3_names_the_agent_as_the_session_mode() {
        let mut wire = Script::new(kiro(vec![]));
        let outcome = converse(&mut wire, &plan(Adapter::KiroV3, &[]));
        assert_eq!(outcome.ending, Ending::Completed);
        assert!(
            wire.sent[1].contains(r#""_meta":{"kiro":{"modeId":"k-a"}}"#),
            "{}",
            wire.sent[1]
        );
    }

    #[test]
    fn a_session_that_does_not_run_as_the_stage_agent_fails_the_stage() {
        let mut wire = Script::new(|sent: &Json| {
            let n = id(sent);
            match method(sent) {
                "initialize" => vec![frame(&format!(
                    r#"{{"id":{n},"result":{{"protocolVersion":1}}}}"#
                ))],
                "session/new" => vec![frame(&format!(
                    r#"{{"id":{n},"result":{{"sessionId":"s1","modes":{{"currentModeId":"default-agent"}}}}}}"#
                ))],
                _ => Vec::new(),
            }
        });
        let outcome = converse(&mut wire, &plan(Adapter::KiroV3, &[]));
        let Ending::Failed(why) = outcome.ending else {
            panic!("{outcome:?}")
        };
        assert!(
            why.contains("`k-a`") && why.contains("default-agent"),
            "{why}"
        );
        assert_eq!(wire.sent.len(), 2, "no prompt is sent");
    }

    /// A Claude adapter. `mode_after` is the mode its answer to `session/set_config_option` reports.
    fn claude(mode_after: &'static str, agent: &'static str) -> impl FnMut(&Json) -> Vec<Incoming> {
        move |sent| {
            let n = id(sent);
            match method(sent) {
                "initialize" => vec![frame(&format!(
                    r#"{{"id":{n},"result":{{"protocolVersion":1}}}}"#
                ))],
                "session/new" => vec![frame(&format!(
                    r#"{{"id":{n},"result":{{"sessionId":"s1","configOptions":[{{"id":"mode","currentValue":"auto"}},{{"id":"agent","currentValue":"{agent}"}}]}}}}"#
                ))],
                "session/set_config_option" => vec![frame(&format!(
                    r#"{{"id":{n},"result":{{"configOptions":[{{"id":"mode","currentValue":"{mode_after}"}}]}}}}"#
                ))],
                "session/prompt" => vec![
                    chunk("done"),
                    frame(&format!(
                        r#"{{"id":{n},"result":{{"stopReason":"end_turn"}}}}"#
                    )),
                ],
                _ => Vec::new(),
            }
        }
    }

    #[test]
    fn claude_gets_its_agent_the_project_settings_only_and_mode_default_before_the_prompt() {
        let mut wire = Script::new(claude("default", "k-a"));
        let outcome = converse(&mut wire, &plan(Adapter::Claude, &[]));
        assert_eq!(outcome.ending, Ending::Completed);
        assert_eq!(
            wire.sent[1],
            r#"{"id":2,"jsonrpc":"2.0","method":"session/new","params":{"_meta":{"claudeCode":{"options":{"agent":"k-a","settingSources":["project"]}}},"cwd":"/p","mcpServers":[]}}"#
        );
        assert_eq!(
            wire.sent[2],
            r#"{"id":3,"jsonrpc":"2.0","method":"session/set_config_option","params":{"configId":"mode","sessionId":"s1","value":"default"}}"#
        );
        assert_eq!(
            method(&json::parse(&wire.sent[3]).unwrap()),
            "session/prompt"
        );
    }

    #[test]
    fn claude_fails_the_stage_when_the_mode_is_not_confirmed_and_never_sends_the_prompt() {
        let mut wire = Script::new(claude("auto", "k-a"));
        let outcome = converse(&mut wire, &plan(Adapter::Claude, &[]));
        let Ending::Failed(why) = outcome.ending else {
            panic!("{outcome:?}")
        };
        assert!(why.contains("`default`"), "{why}");
        assert!(wire.sent.iter().all(|f| !f.contains("session/prompt")));
    }

    #[test]
    fn claude_accepts_a_mode_update_as_the_confirmation_when_the_answer_names_no_mode() {
        let mut inner = claude("auto", "k-a");
        let mut wire = Script::new(move |sent: &Json| {
            let mut out = inner(sent);
            if method(sent) == "session/set_config_option" {
                // The answer carries no mode, so the update is what there is to go by.
                out = vec![frame(&format!(
                    r#"{{"id":{},"result":{{"configOptions":[]}}}}"#,
                    id(sent)
                ))];
                out.insert(
                    0,
                    frame(r#"{"method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"current_mode_update","currentModeId":"default"}}}"#),
                );
            }
            out
        });
        assert_eq!(
            converse(&mut wire, &plan(Adapter::Claude, &[])).ending,
            Ending::Completed
        );
    }

    #[test]
    fn claude_fails_the_stage_when_the_agent_is_not_the_one_asked_for() {
        let mut wire = Script::new(claude("default", "default"));
        let outcome = converse(&mut wire, &plan(Adapter::Claude, &[]));
        assert!(matches!(outcome.ending, Ending::Failed(_)), "{outcome:?}");
        assert_eq!(wire.sent.len(), 2);
    }

    #[test]
    fn an_adapter_that_serves_version_2_only_is_refused_with_the_version_named() {
        let mut wire = Script::new(|sent: &Json| {
            vec![frame(&format!(
                r#"{{"id":{},"result":{{"protocolVersion":2}}}}"#,
                id(sent)
            ))]
        });
        let outcome = converse(&mut wire, &plan(Adapter::KiroV3, &[]));
        let Ending::Refused(why) = outcome.ending else {
            panic!("{outcome:?}")
        };
        assert!(
            why.contains("version 2") && why.contains("version 1"),
            "{why}"
        );
        assert_eq!(wire.sent.len(), 1);
    }

    fn permission(n: u64, tool: &str, kinds: &[(&str, &str)]) -> Incoming {
        let options: Vec<String> = kinds
            .iter()
            .map(|(id, kind)| format!(r#"{{"optionId":"{id}","name":"x","kind":"{kind}"}}"#))
            .collect();
        frame(&format!(
            r#"{{"jsonrpc":"2.0","id":{n},"method":"session/request_permission","params":{{"sessionId":"s1","toolCall":{{"name":"{tool}"}},"options":[{}]}}}}"#,
            options.join(",")
        ))
    }

    const OFFERED: &[(&str, &str)] = &[
        ("yes", "allow_once"),
        ("always", "allow_always"),
        ("no", "reject_once"),
    ];

    #[test]
    fn a_request_that_a_rule_names_is_allowed_once_and_the_turn_goes_on() {
        let rules = vec!["Write".to_string()];
        let mut wire = Script::new(kiro(vec![permission(7, "Write", OFFERED), chunk("ok")]));
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &rules));
        assert_eq!(
            outcome,
            Outcome {
                ending: Ending::Completed,
                text: "ok".to_string()
            }
        );
        assert_eq!(
            wire.sent.last().unwrap(),
            r#"{"id":7,"jsonrpc":"2.0","result":{"outcome":{"optionId":"yes","outcome":"selected"}}}"#
        );
    }

    #[test]
    fn a_request_that_no_rule_names_is_rejected_and_ends_the_conversation_naming_the_tool() {
        let mut wire = Script::new(kiro(vec![
            permission(7, "Bash", OFFERED),
            chunk("never read"),
        ]));
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &["Write".to_string()]));
        let Ending::Denied(why) = outcome.ending else {
            panic!("{outcome:?}")
        };
        assert!(why.contains("`Bash`"), "{why}");
        assert!(
            why.contains("the agent file `.kiro/agents/k-a.json`"),
            "{why}"
        );
        assert_eq!(outcome.text, "");
        let sent = &wire.sent;
        assert!(
            sent[sent.len() - 2].contains(r#""optionId":"no""#),
            "{sent:?}"
        );
        assert!(sent[sent.len() - 1].contains("session/cancel"), "{sent:?}");
        assert!(sent.iter().all(|f| !f.contains(r#""optionId":"always""#)));
    }

    #[test]
    fn a_request_with_only_allow_always_is_never_allowed() {
        let rules = vec!["Write".to_string()];
        let offered = [("always", "allow_always"), ("no", "reject_once")];
        let mut wire = Script::new(kiro(vec![permission(7, "Write", &offered)]));
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &rules));
        let Ending::Denied(why) = outcome.ending else {
            panic!("{outcome:?}")
        };
        assert!(why.contains("`Write`") && why.contains("once"), "{why}");
        assert!(why.contains("`.kiro/agents/k-a.json` allows"), "{why}");
        assert!(wire
            .sent
            .iter()
            .all(|f| !f.contains(r#""optionId":"always""#)));
    }

    #[test]
    fn a_request_with_no_reject_option_is_answered_cancelled() {
        let mut wire = Script::new(kiro(vec![permission(7, "Bash", &[("a", "allow_always")])]));
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &[]));
        assert!(matches!(outcome.ending, Ending::Denied(_)));
        let sent = &wire.sent;
        assert_eq!(
            sent[sent.len() - 2],
            r#"{"id":7,"jsonrpc":"2.0","result":{"outcome":{"outcome":"cancelled"}}}"#
        );
    }

    #[test]
    fn the_message_is_the_chunks_in_order_and_nothing_else() {
        let thought = frame(
            r#"{"method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"SECRET"}}}}"#,
        );
        let tool = frame(
            r#"{"method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"tool_call","title":"x"}}}"#,
        );
        let other = frame(
            r#"{"method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"usage_update"}}}"#,
        );
        let elsewhere = frame(
            r#"{"method":"session/update","params":{"sessionId":"other","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"NOPE"}}}}"#,
        );
        let image = frame(
            r#"{"method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"image","data":"x"}}}}"#,
        );
        let vendor = frame(r#"{"method":"_kiro/tools/didChange","params":{"x":1}}"#);
        let mut wire = Script::new(kiro(vec![
            chunk("a"),
            thought,
            chunk("b"),
            other,
            elsewhere,
            image,
            vendor,
            tool,
            chunk("c\n"),
            chunk("d"),
        ]));
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &[]));
        assert_eq!(outcome.text, "ab\nc\nd");
    }

    #[test]
    fn a_new_message_id_starts_a_new_line() {
        let with_id = |text: &str, id: &str| {
            frame(&format!(
                r#"{{"method":"session/update","params":{{"sessionId":"s1","update":{{"sessionUpdate":"agent_message_chunk","messageId":"{id}","content":{{"type":"text","text":"{text}"}}}}}}}}"#
            ))
        };
        let mut wire = Script::new(kiro(vec![
            with_id("one", "m1"),
            with_id("+", "m1"),
            with_id("two", "m2"),
        ]));
        assert_eq!(
            converse(&mut wire, &plan(Adapter::KiroV2, &[])).text,
            "one+\ntwo"
        );
    }

    #[test]
    fn only_the_last_mebibyte_of_the_message_is_kept() {
        let piece = "x".repeat(300_000);
        let mut chunks: Vec<Incoming> = (0..10).map(|_| chunk(&piece)).collect();
        chunks.push(chunk("END"));
        let mut wire = Script::new(kiro(chunks));
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &[]));
        assert_eq!(outcome.ending, Ending::Completed);
        assert_eq!(outcome.text.len(), MAX_SESSION_OUTPUT_BYTES);
        assert!(outcome.text.ends_with("xEND"));
    }

    #[test]
    fn a_frame_that_is_not_json_or_has_the_wrong_id_or_is_too_long_ends_the_stage_with_the_cause() {
        let cases: Vec<(Incoming, &str)> = vec![
            (frame("not json"), "not JSON"),
            (frame("[1]"), "not a JSON object"),
            (frame(r#"{"id":99,"result":{}}"#), "id 99"),
            (
                frame(r#"{"foo":1}"#),
                "no request, notification or response",
            ),
            (Incoming::TooLong, "byte limit"),
            (Incoming::NotUtf8, "not UTF-8"),
            (Incoming::Failed("boom2".to_string()), "boom2"),
            (Incoming::Failed("boom".to_string()), "boom"),
            (
                frame(r#"{"id":1,"error":{"code":-32602,"message":"bad"}}"#),
                "-32602 bad",
            ),
            (frame(r#"{"id":1}"#), "no result"),
        ];
        for (reply, expected) in cases {
            let mut once = Some(reply);
            let mut wire = Script::new(move |_: &Json| once.take().into_iter().collect());
            let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &[]));
            let Ending::Failed(why) = outcome.ending else {
                panic!("{expected}: {outcome:?}")
            };
            assert!(why.contains(expected), "{expected}: {why}");
        }
    }

    #[test]
    fn an_adapter_that_closes_its_output_is_reported_as_closed() {
        let mut wire = Script::new(|_: &Json| vec![Incoming::Closed]);
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &[]));
        let Ending::Closed(why) = outcome.ending else {
            panic!("{outcome:?}")
        };
        assert!(
            why.contains("ended its output before it answered `initialize`"),
            "{why}"
        );
    }

    #[test]
    fn a_turn_that_does_not_end_with_end_turn_fails_the_stage() {
        for reason in ["max_tokens", "refusal", "cancelled", "max_turn_requests"] {
            let mut wire = Script::new(|sent: &Json| {
                let n = id(sent);
                match method(sent) {
                    "initialize" => vec![frame(&format!(
                        r#"{{"id":{n},"result":{{"protocolVersion":1}}}}"#
                    ))],
                    "session/new" => vec![frame(&format!(
                        r#"{{"id":{n},"result":{{"sessionId":"s1","modes":{{"currentModeId":"k-a"}}}}}}"#
                    ))],
                    _ => vec![frame(&format!(
                        r#"{{"id":{n},"result":{{"stopReason":"{reason}"}}}}"#
                    ))],
                }
            });
            let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &[]));
            let Ending::Failed(why) = outcome.ending else {
                panic!("{reason}")
            };
            assert!(why.contains(reason), "{why}");
        }
    }

    #[test]
    fn the_adapter_is_told_no_when_it_asks_for_something_this_client_does_not_serve() {
        let ask = frame(r#"{"jsonrpc":"2.0","id":"abc","method":"fs/read_text_file","params":{}}"#);
        let mut wire = Script::new(kiro(vec![ask]));
        assert_eq!(
            converse(&mut wire, &plan(Adapter::KiroV2, &[])).ending,
            Ending::Completed
        );
        assert!(wire
            .sent
            .iter()
            .any(|f| f == r#"{"error":{"code":-32601,"message":"method not found"},"id":"abc","jsonrpc":"2.0"}"#));
    }

    #[test]
    fn at_the_time_limit_the_client_sends_cancel_and_ends_as_timed_out() {
        // The scripted wire reports a timeout when nothing is queued, and never answers the prompt.
        let mut wire = Script::new(|sent: &Json| {
            let n = id(sent);
            match method(sent) {
                "initialize" => vec![frame(&format!(
                    r#"{{"id":{n},"result":{{"protocolVersion":1}}}}"#
                ))],
                "session/new" => vec![frame(&format!(
                    r#"{{"id":{n},"result":{{"sessionId":"s1","modes":{{"currentModeId":"k-a"}}}}}}"#
                ))],
                "session/prompt" => vec![chunk("partial")],
                _ => Vec::new(),
            }
        });
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &[]));
        assert_eq!(
            outcome,
            Outcome {
                ending: Ending::TimedOut,
                text: "partial".to_string()
            }
        );
        assert_eq!(
            wire.sent.last().unwrap(),
            r#"{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"s1"}}"#
        );
    }

    #[test]
    fn a_permission_request_during_the_cancel_wait_is_answered_cancelled() {
        let mut wire = Script::new(move |sent: &Json| {
            let n = id(sent);
            match method(sent) {
                "initialize" => vec![frame(&format!(
                    r#"{{"id":{n},"result":{{"protocolVersion":1}}}}"#
                ))],
                "session/new" => vec![frame(&format!(
                    r#"{{"id":{n},"result":{{"sessionId":"s1","modes":{{"currentModeId":"k-a"}}}}}}"#
                ))],
                "session/cancel" => {
                    vec![
                        permission(8, "Write", OFFERED),
                        frame(r#"{"id":3,"result":{"stopReason":"cancelled"}}"#),
                    ]
                }
                _ => Vec::new(),
            }
        });
        let rules = vec!["Write".to_string()];
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &rules));
        assert_eq!(outcome.ending, Ending::TimedOut);
        assert!(wire.sent.iter().any(
            |f| f == r#"{"id":8,"jsonrpc":"2.0","result":{"outcome":{"outcome":"cancelled"}}}"#
        ));
    }

    /// A wire that answers the handshake like a Kiro adapter and, once the prompt is sent, never stops sending message
    /// chunks and never answers the prompt.
    struct Chatty {
        prompted: bool,
        queue: VecDeque<Incoming>,
    }

    impl Wire for Chatty {
        fn send(&mut self, frame: &str) -> Result<(), String> {
            let sent = json::parse(frame).unwrap();
            let n = id(&sent);
            match method(&sent) {
                "initialize" => self.queue.push_back(frame_of(&format!(
                    r#"{{"id":{n},"result":{{"protocolVersion":1}}}}"#
                ))),
                "session/new" => self.queue.push_back(frame_of(&format!(
                    r#"{{"id":{n},"result":{{"sessionId":"s1","modes":{{"currentModeId":"k-a"}}}}}}"#
                ))),
                "session/prompt" => self.prompted = true,
                _ => {}
            }
            Ok(())
        }

        fn recv(&mut self, _until: Instant) -> Incoming {
            // Like the real wire, a frame that is ready is returned whatever the deadline.
            match self.queue.pop_front() {
                Some(item) => item,
                None if self.prompted => chunk("talking"),
                None => Incoming::TimedOut,
            }
        }
    }

    fn frame_of(text: &str) -> Incoming {
        Incoming::Frame(text.to_string())
    }

    #[test]
    fn an_adapter_that_keeps_talking_cannot_extend_the_time_limit_or_the_cancel_wait() {
        let mut wire = Chatty {
            prompted: false,
            queue: VecDeque::new(),
        };
        let mut limited = plan(Adapter::KiroV2, &[]);
        limited.limit = Instant::now() + Duration::from_millis(30);
        limited.grace = Duration::from_millis(30);
        let began = Instant::now();
        let outcome = converse(&mut wire, &limited);
        assert_eq!(outcome.ending, Ending::TimedOut);
        assert!(outcome.text.starts_with("talking"));
        assert!(began.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_request_id_that_is_not_a_number_or_a_short_string_fails_the_stage() {
        let long = "x".repeat(MAX_REQUEST_ID_BYTES + 1);
        let fits = "x".repeat(MAX_REQUEST_ID_BYTES);
        let bad = [
            format!(r#"{{"id":"{long}","method":"fs/read_text_file"}}"#),
            r#"{"id":{"a":1},"method":"fs/read_text_file"}"#.to_string(),
            r#"{"id":[1],"method":"fs/read_text_file"}"#.to_string(),
            r#"{"id":null,"method":"fs/read_text_file"}"#.to_string(),
            r#"{"id":true,"method":"fs/read_text_file"}"#.to_string(),
        ];
        for ask in bad {
            let mut wire = Script::new(kiro(vec![frame_of(&ask)]));
            let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &[]));
            let Ending::Failed(why) = outcome.ending else {
                panic!("{ask}: {outcome:?}")
            };
            assert!(
                why.contains("not a number or a string of at most 256 bytes"),
                "{why}"
            );
            // Nothing was echoed back.
            assert!(wire.sent.iter().all(|f| !f.contains("xxxx")), "{ask}");
        }
        for ok in [
            format!(r#"{{"id":"{fits}","method":"fs/read_text_file"}}"#),
            r#"{"id":-7,"method":"fs/read_text_file"}"#.to_string(),
            r#"{"id":0,"method":"fs/read_text_file"}"#.to_string(),
        ] {
            let mut wire = Script::new(kiro(vec![frame_of(&ok)]));
            assert_eq!(
                converse(&mut wire, &plan(Adapter::KiroV2, &[])).ending,
                Ending::Completed,
                "{ok}"
            );
        }
    }

    #[test]
    fn an_adapter_that_sends_too_many_requests_in_one_stage_fails_it() {
        let asks: Vec<Incoming> = (0..=MAX_ADAPTER_REQUESTS)
            .map(|n| frame_of(&format!(r#"{{"id":{n},"method":"fs/read_text_file"}}"#)))
            .collect();
        let mut wire = Script::new(kiro(asks));
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &[]));
        let Ending::Failed(why) = outcome.ending else {
            panic!("{outcome:?}")
        };
        assert!(why.contains("more than 1000 requests"), "{why}");
        let few: Vec<Incoming> = (0..MAX_ADAPTER_REQUESTS)
            .map(|n| frame_of(&format!(r#"{{"id":{n},"method":"fs/read_text_file"}}"#)))
            .collect();
        let mut wire = Script::new(kiro(few));
        assert_eq!(
            converse(&mut wire, &plan(Adapter::KiroV2, &[])).ending,
            Ending::Completed
        );
    }

    #[test]
    fn a_permission_request_for_another_session_is_answered_cancelled_and_fails_the_stage() {
        let other = frame_of(
            r#"{"id":7,"method":"session/request_permission","params":{"sessionId":"s2","toolCall":{"name":"Write"},"options":[{"optionId":"yes","name":"x","kind":"allow_once"}]}}"#,
        );
        let rules = vec!["Write".to_string()];
        let mut wire = Script::new(kiro(vec![other]));
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &rules));
        let Ending::Failed(why) = outcome.ending else {
            panic!("{outcome:?}")
        };
        assert!(why.contains("another session"), "{why}");
        assert!(wire.sent.iter().all(|f| !f.contains(r#""optionId":"yes""#)));
        assert!(wire.sent.iter().any(
            |f| f == r#"{"id":7,"jsonrpc":"2.0","result":{"outcome":{"outcome":"cancelled"}}}"#
        ));
    }

    #[test]
    fn an_answer_that_names_another_mode_is_not_rescued_by_an_earlier_update() {
        let mut inner = claude("auto", "k-a");
        let mut wire = Script::new(move |sent: &Json| {
            let mut out = inner(sent);
            if method(sent) == "session/new" {
                out.push(frame_of(
                    r#"{"method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"current_mode_update","currentModeId":"default"}}}"#,
                ));
            }
            out
        });
        let outcome = converse(&mut wire, &plan(Adapter::Claude, &[]));
        assert!(matches!(outcome.ending, Ending::Failed(_)), "{outcome:?}");
        assert!(wire.sent.iter().all(|f| !f.contains("session/prompt")));
    }

    #[test]
    fn a_later_change_of_the_permission_mode_fails_the_stage() {
        for mode in ["acceptEdits", "bypassPermissions", "auto"] {
            let mut inner = claude("default", "k-a");
            let mut wire = Script::new(move |sent: &Json| {
                let mut out = inner(sent);
                if method(sent) == "session/prompt" {
                    out.insert(
                        0,
                        frame_of(&format!(
                            r#"{{"method":"session/update","params":{{"sessionId":"s1","update":{{"sessionUpdate":"current_mode_update","currentModeId":"{mode}"}}}}}}"#
                        )),
                    );
                }
                out
            });
            let outcome = converse(&mut wire, &plan(Adapter::Claude, &[]));
            let Ending::Failed(why) = outcome.ending else {
                panic!("{mode}: {outcome:?}")
            };
            assert!(why.contains(&format!("`{mode}`")), "{why}");
        }
    }

    #[test]
    fn permission_requests_are_not_counted_against_the_cap_on_the_adapters_other_requests() {
        let rules = vec!["Write".to_string()];
        let asks: Vec<Incoming> = (0..MAX_ADAPTER_REQUESTS + 500)
            .map(|n| permission(n as u64, "Write", OFFERED))
            .collect();
        let mut wire = Script::new(kiro(asks));
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &rules));
        assert_eq!(outcome.ending, Ending::Completed);
        let allowed = wire
            .sent
            .iter()
            .filter(|f| f.contains(r#""optionId":"yes""#))
            .count();
        assert_eq!(allowed, MAX_ADAPTER_REQUESTS + 500);
    }

    #[test]
    fn a_permission_request_whose_session_id_is_not_a_string_fails_the_stage() {
        let odd = frame_of(
            r#"{"id":7,"method":"session/request_permission","params":{"sessionId":5,"toolCall":{"name":"Write"},"options":[{"optionId":"yes","name":"x","kind":"allow_once"}]}}"#,
        );
        let rules = vec!["Write".to_string()];
        let mut wire = Script::new(kiro(vec![odd]));
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &rules));
        assert!(matches!(outcome.ending, Ending::Failed(_)), "{outcome:?}");
        assert!(wire.sent.iter().all(|f| !f.contains(r#""optionId":"yes""#)));
    }

    #[test]
    fn a_startup_mode_update_does_not_fail_a_stage_whose_mode_the_answer_confirmed() {
        let mut inner = claude("default", "k-a");
        let mut wire = Script::new(move |sent: &Json| {
            let mut out = inner(sent);
            if method(sent) == "session/new" {
                out.push(frame_of(
                    r#"{"method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"current_mode_update","currentModeId":"auto"}}}"#,
                ));
            }
            out
        });
        assert_eq!(
            converse(&mut wire, &plan(Adapter::Claude, &[])).ending,
            Ending::Completed
        );
    }

    #[test]
    fn a_mode_change_reported_as_a_config_option_update_fails_the_stage() {
        let mut inner = claude("default", "k-a");
        let mut wire = Script::new(move |sent: &Json| {
            let mut out = inner(sent);
            if method(sent) == "session/prompt" {
                out.insert(
                    0,
                    frame_of(
                        r#"{"method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"config_option_update","configOptions":[{"id":"mode","currentValue":"bypassPermissions"}]}}}"#,
                    ),
                );
            }
            out
        });
        let outcome = converse(&mut wire, &plan(Adapter::Claude, &[]));
        let Ending::Failed(why) = outcome.ending else {
            panic!("{outcome:?}")
        };
        assert!(why.contains("`bypassPermissions`"), "{why}");
    }

    /// A wire that answers like a Kiro adapter and reports an interrupt once the prompt has been sent.
    struct Interrupting {
        inner: Chatty,
        interrupted: bool,
    }

    impl Wire for Interrupting {
        fn send(&mut self, frame: &str) -> Result<(), String> {
            if frame.contains("session/prompt") {
                self.interrupted = true;
            }
            self.inner.send(frame)
        }

        fn recv(&mut self, until: Instant) -> Incoming {
            self.inner.recv(until)
        }

        fn interrupted(&self) -> bool {
            self.interrupted
        }
    }

    #[test]
    fn an_interrupt_ends_the_conversation_with_no_cancel_even_while_frames_keep_coming() {
        let mut wire = Interrupting {
            inner: Chatty {
                prompted: false,
                queue: VecDeque::new(),
            },
            interrupted: false,
        };
        let outcome = converse(&mut wire, &plan(Adapter::KiroV2, &[]));
        assert_eq!(outcome.ending, Ending::Interrupted);
        assert!(wire.inner.prompted);
    }

    #[test]
    fn frames_are_built_without_a_line_break() {
        assert!(!initialize_params().compact().contains('\n'));
        let prompt = request(3, "session/prompt", prompt_params("s", "a\nb"));
        assert!(!prompt.contains('\n'));
        assert!(prompt.contains(r"a\nb"));
    }
}
