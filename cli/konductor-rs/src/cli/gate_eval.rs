// SPDX-License-Identifier: Apache-2.0
//
// gate_eval.rs: judges a SOP session file against the gate boundaries in
// sop-orchestration.yml and the severity words in severity-schema.yml.
//
// Pure: the evaluator opens no file. It takes an already-parsed session, the
// gate map, a severity policy and an evidence check, so a new session source
// can be added later without touching the verdict rows.

use std::collections::BTreeMap;

use serde_yaml::Value;

use super::config::Severity;
use super::gate_config::{GateKind, GateMap, GatedSop, Scope, SeverityTable, WordRank};
use super::{
    EXIT_BUDGET_EXCEEDED, EXIT_CRITICAL_GATE, EXIT_HALTED, EXIT_SUCCESS_WITH_WARNINGS,
    EXIT_USAGE_ERROR, EXIT_VERIFY_FAILED,
};

/// The skill's own `run.schema_version`.
const SCHEMA_VERSION: u64 = 1;

/// No configured threshold can make a phase-gated SOP laxer than this.
const STRICT_FLOOR: Severity = Severity::High;

/// The fix-cycle cap. A recorded `max_fix_cycles` can lower it, never raise it.
const MAX_FIX_CYCLES: u64 = 2;

const ORCHESTRATOR: &str = "konductor";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RunStatus {
    InProgress,
    Completed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PhaseStatus {
    Pending,
    Skipped,
    InProgress,
    Completed,
    Blocked,
}

impl PhaseStatus {
    fn parse(word: &str) -> Option<Self> {
        match word {
            "PENDING" => Some(Self::Pending),
            "SKIPPED" => Some(Self::Skipped),
            "IN_PROGRESS" => Some(Self::InProgress),
            "COMPLETED" => Some(Self::Completed),
            "BLOCKED" => Some(Self::Blocked),
            _ => None,
        }
    }

    fn is_unfinished(self) -> bool {
        matches!(self, Self::Pending | Self::InProgress)
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Skipped => "SKIPPED",
            Self::InProgress => "IN_PROGRESS",
            Self::Completed => "COMPLETED",
            Self::Blocked => "BLOCKED",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PhaseEntry {
    pub(crate) id: String,
    pub(crate) status: PhaseStatus,
    pub(crate) skip_reason: Option<String>,
}

/// A `counters` and `data` pair, as the skill keeps for the run and for
/// each feature.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Bag {
    pub(crate) counters: BTreeMap<String, u64>,
    pub(crate) data: BTreeMap<String, Value>,
}

/// The fields of a `sop-state-management` session file the gates read.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Session {
    pub(crate) run_status: RunStatus,
    /// In file order.
    pub(crate) phases: Vec<PhaseEntry>,
    pub(crate) run: Bag,
    pub(crate) features: BTreeMap<String, Bag>,
}

/// Why a parsed YAML value is not a usable session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SessionError {
    /// A construct the restricted loader refuses (V1).
    Invalid(String),
    /// Parses, but breaks the skill's schema (V2).
    Integrity(String),
}

impl Session {
    pub(crate) fn from_yaml_value(value: &Value) -> Result<Session, SessionError> {
        reject_non_data(value, "session")?;
        let root = as_mapping(value, "session")?;
        let run_value = required(root, "run", "session")?;
        let run = as_mapping(run_value, "run")?;

        match required(run, "schema_version", "run")?.as_u64() {
            Some(SCHEMA_VERSION) => {}
            _ => {
                return Err(integrity(format!(
                    "run.schema_version is not {SCHEMA_VERSION}"
                )))
            }
        }
        let run_status = match required(run, "run_status", "run")?.as_str() {
            Some("in_progress") => RunStatus::InProgress,
            Some("completed") => RunStatus::Completed,
            _ => return Err(integrity("run.run_status is not in_progress or completed")),
        };

        let phases = as_mapping(required(root, "phases", "session")?, "phases")?
            .iter()
            .map(|(key, entry)| parse_phase(key, entry))
            .collect::<Result<Vec<_>, _>>()?;

        let features = match root.get("features") {
            None | Some(Value::Null) => BTreeMap::new(),
            Some(value) => as_mapping(value, "features")?
                .iter()
                .map(|(slug, bag)| {
                    let slug = key_str(slug)?;
                    let bag = parse_bag(bag, &format!("features.{slug}"))?;
                    Ok((slug.to_string(), bag))
                })
                .collect::<Result<_, SessionError>>()?,
        };

        Ok(Session {
            run_status,
            phases,
            run: parse_bag(run_value, "run")?,
            features,
        })
    }
}

/// Where the evaluator reads phases, statuses, gate facts and counters.
pub(crate) trait SessionSource {
    fn session(&self) -> &Session;
}

impl SessionSource for Session {
    fn session(&self) -> &Session {
        self
    }
}

/// Word to rank, the configured threshold, and the strict floor.
#[derive(Debug, Clone)]
pub(crate) struct SeverityPolicy {
    pub(crate) table: SeverityTable,
    pub(crate) threshold: Severity,
}

impl SeverityPolicy {
    /// The configured threshold or `STRICT_FLOOR`, whichever ranks lower.
    pub(crate) fn effective_threshold(&self) -> Severity {
        if self.threshold.rank() > STRICT_FLOOR.rank() {
            STRICT_FLOOR
        } else {
            self.threshold
        }
    }

    /// A word in no list ranks as CRITICAL.
    fn rank_of_word(&self, word: &str) -> (Severity, bool) {
        match self.table.rank_of_word(word) {
            WordRank::Known(severity) => (severity, true),
            WordRank::Unknown => (Severity::Critical, false),
        }
    }
}

/// Everything besides the session that a verdict depends on.
pub(crate) struct EvalContext<'a> {
    /// The SOP name taken from the session file's name.
    pub(crate) session_prefix: &'a str,
    pub(crate) gate_map: &'a GateMap,
    pub(crate) policy: &'a SeverityPolicy,
    /// True when a recorded evidence path names a regular file inside the
    /// project root.
    pub(crate) evidence_exists: &'a dyn Fn(&str) -> bool,
    pub(crate) allow_running: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReasonCode {
    SessionInvalid,
    ConfigInvalid,
    RecordIntegrity,
    PhaseOrder,
    PhaseIncomplete,
    SkipUnexplained,
    GateMissing,
    ApprovalMissing,
    EvidenceMissing,
    Halted,
    BudgetExceeded,
    FindingUnresolved,
    Passed,
    Running,
}

impl ReasonCode {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::SessionInvalid => "SESSION_INVALID",
            Self::ConfigInvalid => "CONFIG_INVALID",
            Self::RecordIntegrity => "RECORD_INTEGRITY",
            Self::PhaseOrder => "PHASE_ORDER",
            Self::PhaseIncomplete => "PHASE_INCOMPLETE",
            Self::SkipUnexplained => "SKIP_UNEXPLAINED",
            Self::GateMissing => "GATE_MISSING",
            Self::ApprovalMissing => "APPROVAL_MISSING",
            Self::EvidenceMissing => "EVIDENCE_MISSING",
            Self::Halted => "HALTED",
            Self::BudgetExceeded => "BUDGET_EXCEEDED",
            Self::FindingUnresolved => "FINDING_UNRESOLVED",
            Self::Passed => "PASSED",
            Self::Running => "RUNNING",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InfoCode {
    SameTypeChecker,
    SeverityUnknown,
    FindingBelowGate,
    FixCapClamped,
    PhaseSkipped,
}

impl InfoCode {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::SameTypeChecker => "SAME_TYPE_CHECKER",
            Self::SeverityUnknown => "SEVERITY_UNKNOWN",
            Self::FindingBelowGate => "FINDING_BELOW_GATE",
            Self::FixCapClamped => "FIX_CAP_CLAMPED",
            Self::PhaseSkipped => "PHASE_SKIPPED",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Reason {
    pub(crate) code: ReasonCode,
    pub(crate) detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Info {
    pub(crate) code: InfoCode,
    pub(crate) detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Verdict {
    pub(crate) exit: u8,
    pub(crate) reasons: Vec<Reason>,
    pub(crate) info: Vec<Info>,
}

/// Collects firing rows in V order; the first one sets the exit.
#[derive(Default)]
struct Report {
    exit: Option<u8>,
    reasons: Vec<Reason>,
    info: Vec<Info>,
}

impl Report {
    fn fire(&mut self, exit: u8, code: ReasonCode, detail: impl Into<String>) {
        self.exit.get_or_insert(exit);
        self.reasons.push(Reason {
            code,
            detail: detail.into(),
        });
    }

    fn note(&mut self, code: InfoCode, detail: impl Into<String>) {
        self.info.push(Info {
            code,
            detail: detail.into(),
        });
    }

    fn fired(&self) -> bool {
        self.exit.is_some()
    }

    fn into_verdict(self) -> Verdict {
        Verdict {
            exit: self.exit.unwrap_or(0),
            reasons: self.reasons,
            info: self.info,
        }
    }
}

/// Parses `value` as a session, then evaluates it.
pub(crate) fn evaluate_value(value: &Value, ctx: &EvalContext<'_>) -> Verdict {
    match Session::from_yaml_value(value) {
        Ok(session) => evaluate(&session, ctx),
        Err(err) => {
            let mut report = Report::default();
            match err {
                SessionError::Invalid(detail) => {
                    report.fire(EXIT_USAGE_ERROR, ReasonCode::SessionInvalid, detail)
                }
                SessionError::Integrity(detail) => {
                    report.fire(EXIT_VERIFY_FAILED, ReasonCode::RecordIntegrity, detail)
                }
            }
            report.into_verdict()
        }
    }
}

/// Runs rows V2 to V9 over one session.
pub(crate) fn evaluate(source: &dyn SessionSource, ctx: &EvalContext<'_>) -> Verdict {
    let session = source.session();
    let mut report = Report::default();

    let Some(sop) = check_phase_map(session, ctx, &mut report) else {
        return report.into_verdict();
    };
    check_phase_order(session, sop, &mut report);
    check_boundaries(session, sop, ctx, &mut report);
    check_halted(session, sop, &mut report);
    check_fix_cycles(session, &mut report);
    check_findings(session, sop, ctx.policy, &mut report);

    if !report.fired() {
        let skipped = report.info.iter().any(|i| i.code == InfoCode::PhaseSkipped);
        match session.run_status {
            RunStatus::Completed if skipped => report.fire(
                EXIT_SUCCESS_WITH_WARNINGS,
                ReasonCode::Passed,
                "run completed with a skipped gate",
            ),
            RunStatus::Completed => report.fire(0, ReasonCode::Passed, "run completed"),
            RunStatus::InProgress if ctx.allow_running => {
                report.fire(0, ReasonCode::Running, "run is in progress")
            }
            RunStatus::InProgress => report.fire(
                EXIT_VERIFY_FAILED,
                ReasonCode::Running,
                "run is in progress; pass --allow-running to accept it",
            ),
        }
    }
    report.into_verdict()
}

/// V2: the prefix names a gated SOP with a phase list, and the session's
/// phase keys equal that list in order. Later rows need both, so a miss
/// stops here.
fn check_phase_map<'m>(
    session: &Session,
    ctx: &EvalContext<'m>,
    report: &mut Report,
) -> Option<&'m GatedSop> {
    let prefix = ctx.session_prefix;
    let Some(sop) = ctx.gate_map.gated.get(prefix) else {
        report.fire(
            EXIT_VERIFY_FAILED,
            ReasonCode::RecordIntegrity,
            format!("session prefix '{prefix}' is not a gated SOP"),
        );
        return None;
    };
    if sop.phases.is_empty() {
        report.fire(
            EXIT_VERIFY_FAILED,
            ReasonCode::RecordIntegrity,
            format!("gated SOP '{prefix}' has no phases list"),
        );
        return None;
    }
    let recorded: Vec<&str> = session.phases.iter().map(|p| p.id.as_str()).collect();
    if recorded != sop.phases {
        report.fire(
            EXIT_VERIFY_FAILED,
            ReasonCode::RecordIntegrity,
            format!(
                "session phases {recorded:?} differ from '{prefix}' phases {:?}",
                sop.phases
            ),
        );
        return None;
    }
    Some(sop)
}

/// V3. Only a COMPLETED phase counts against an earlier unfinished one:
/// skipped phases are marked SKIPPED at minting, before earlier phases run.
fn check_phase_order(session: &Session, sop: &GatedSop, report: &mut Report) {
    let span = feature_phase_span(sop);
    for (index, earlier) in session.phases.iter().enumerate() {
        if !earlier.status.is_unfinished() || held_open_by_a_feature(session, span, index) {
            continue;
        }
        if let Some(later) = session.phases[index + 1..]
            .iter()
            .find(|p| p.status == PhaseStatus::Completed)
        {
            report.fire(
                EXIT_VERIFY_FAILED,
                ReasonCode::PhaseOrder,
                format!(
                    "phase '{}' is COMPLETED while earlier phase '{}' is {}",
                    later.id,
                    earlier.id,
                    earlier.status.as_str()
                ),
            );
        }
    }
    if session.run_status == RunStatus::Completed {
        for phase in &session.phases {
            if !matches!(phase.status, PhaseStatus::Completed | PhaseStatus::Skipped) {
                report.fire(
                    EXIT_VERIFY_FAILED,
                    ReasonCode::PhaseIncomplete,
                    format!(
                        "run is completed but phase '{}' is {}",
                        phase.id,
                        phase.status.as_str()
                    ),
                );
            }
        }
    }
    for phase in &session.phases {
        let explained = phase
            .skip_reason
            .as_deref()
            .is_some_and(|r| !r.trim().is_empty());
        if phase.status == PhaseStatus::Skipped && !explained {
            report.fire(
                EXIT_VERIFY_FAILED,
                ReasonCode::SkipUnexplained,
                format!("phase '{}' is SKIPPED with no skip_reason", phase.id),
            );
        }
    }
}

/// The index range from the first to the last feature-scope boundary phase.
/// The SOP keeps a per-feature phase IN_PROGRESS while one feature is
/// blocked, so inside this span that status can be an honest stop.
fn feature_phase_span(sop: &GatedSop) -> Option<(usize, usize)> {
    let indices: Vec<usize> = sop
        .boundaries
        .iter()
        .filter(|b| b.scope == Scope::Feature)
        .filter_map(|b| sop.phases.iter().position(|p| *p == b.phase))
        .collect();
    Some((*indices.iter().min()?, *indices.iter().max()?))
}

/// An IN_PROGRESS per-feature phase with a later phase COMPLETED: the run
/// moved on while a registered feature never cleared the phase.
fn held_open_by_a_feature(session: &Session, span: Option<(usize, usize)>, index: usize) -> bool {
    let Some((first, last)) = span else {
        return false;
    };
    session.phases[index].status == PhaseStatus::InProgress
        && (first..=last).contains(&index)
        && !session.features.is_empty()
        && session.phases[index + 1..]
            .iter()
            .any(|p| p.status == PhaseStatus::Completed)
}

/// The `data` maps a boundary's facts live in, with a label for details.
fn fact_targets(session: &Session, scope: Scope) -> Vec<(String, &Bag)> {
    match scope {
        Scope::Run => vec![("run".to_string(), &session.run)],
        Scope::Feature => session
            .features
            .iter()
            .map(|(slug, bag)| (format!("feature '{slug}'"), bag))
            .collect(),
    }
}

fn data_str<'b>(bag: &'b Bag, key: &str) -> Option<&'b str> {
    bag.data.get(key).and_then(Value::as_str)
}

fn phase_status(session: &Session, id: &str) -> Option<PhaseStatus> {
    session.phases.iter().find(|p| p.id == id).map(|p| p.status)
}

/// V4, plus the PHASE_SKIPPED note V8 uses.
fn check_boundaries(session: &Session, sop: &GatedSop, ctx: &EvalContext<'_>, report: &mut Report) {
    for boundary in &sop.boundaries {
        let phase = boundary.phase.as_str();
        match phase_status(session, phase) {
            Some(PhaseStatus::Skipped) => {
                report.note(
                    InfoCode::PhaseSkipped,
                    format!("gate phase '{phase}' was skipped"),
                );
                continue;
            }
            Some(PhaseStatus::Completed) => {}
            _ => continue,
        }
        let targets = fact_targets(session, boundary.scope);
        if targets.is_empty() {
            report.fire(
                EXIT_VERIFY_FAILED,
                ReasonCode::GateMissing,
                format!("phase '{phase}' is COMPLETED with no registered feature"),
            );
        }
        let result_key = format!("gate_{phase}_result");
        let evidence_key = format!("gate_{phase}_evidence");
        for (label, bag) in targets {
            match data_str(bag, &result_key) {
                None => report.fire(
                    EXIT_VERIFY_FAILED,
                    ReasonCode::GateMissing,
                    format!("{label}: phase '{phase}' is COMPLETED with no {result_key}"),
                ),
                Some(result) if boundary.kind == GateKind::Approval && result != "approved" => {
                    report.fire(
                        EXIT_VERIFY_FAILED,
                        ReasonCode::ApprovalMissing,
                        format!("{label}: {result_key} is '{result}', not 'approved'"),
                    )
                }
                Some(_) => {}
            }
            match data_str(bag, &evidence_key) {
                Some(path) if (ctx.evidence_exists)(path) => {}
                Some(path) => report.fire(
                    EXIT_VERIFY_FAILED,
                    ReasonCode::EvidenceMissing,
                    format!("{label}: {evidence_key} '{path}' is not a file in the project"),
                ),
                None => report.fire(
                    EXIT_VERIFY_FAILED,
                    ReasonCode::EvidenceMissing,
                    format!("{label}: phase '{phase}' is COMPLETED with no {evidence_key}"),
                ),
            }
        }
    }
}

/// V5: a BLOCKED phase, or a per-feature phase a feature never cleared.
fn check_halted(session: &Session, sop: &GatedSop, report: &mut Report) {
    let span = feature_phase_span(sop);
    for (index, phase) in session.phases.iter().enumerate() {
        if phase.status == PhaseStatus::Blocked {
            report.fire(
                EXIT_HALTED,
                ReasonCode::Halted,
                format!("phase '{}' is BLOCKED", phase.id),
            );
        } else if held_open_by_a_feature(session, span, index) {
            report.fire(
                EXIT_HALTED,
                ReasonCode::Halted,
                format!(
                    "phase '{}' is IN_PROGRESS after a later phase completed; a feature did not clear it",
                    phase.id
                ),
            );
        }
    }
}

/// V6. The cap comes from the evaluator; the recorded value can only lower it.
fn check_fix_cycles(session: &Session, report: &mut Report) {
    let recorded = session
        .run
        .data
        .get("max_fix_cycles")
        .and_then(Value::as_u64);
    let cap = match recorded {
        Some(value) if value > MAX_FIX_CYCLES => {
            report.note(
                InfoCode::FixCapClamped,
                format!(
                    "max_fix_cycles {value} is above {MAX_FIX_CYCLES}; the cap is {MAX_FIX_CYCLES}"
                ),
            );
            MAX_FIX_CYCLES
        }
        Some(value) => value,
        None => MAX_FIX_CYCLES,
    };
    for (slug, bag) in &session.features {
        let used = bag.counters.get("fix_cycles_used").copied().unwrap_or(0);
        if used > cap {
            report.fire(
                EXIT_BUDGET_EXCEEDED,
                ReasonCode::BudgetExceeded,
                format!("feature '{slug}': fix_cycles_used {used} is above the cap {cap}"),
            );
        }
    }
}

/// V7, plus the SEVERITY_UNKNOWN, FINDING_BELOW_GATE and SAME_TYPE_CHECKER notes.
fn check_findings(session: &Session, sop: &GatedSop, policy: &SeverityPolicy, report: &mut Report) {
    let effective = policy.effective_threshold();
    for boundary in &sop.boundaries {
        if boundary.kind == GateKind::Approval {
            continue;
        }
        let phase = boundary.phase.as_str();
        let result_key = format!("gate_{phase}_result");
        let checker_key = format!("gate_{phase}_checker");
        for (label, bag) in fact_targets(session, boundary.scope) {
            // Sessions record no maker, so the one same-type case visible is
            // the orchestrator checking its own run.
            if boundary.kind == GateKind::CheckThreshold
                && data_str(bag, &checker_key) == Some(ORCHESTRATOR)
            {
                report.note(
                    InfoCode::SameTypeChecker,
                    format!("{label}: {checker_key} is the orchestrator"),
                );
            }
            let Some(word) = data_str(bag, &result_key) else {
                continue;
            };
            if word.trim() == "none" {
                continue;
            }
            let (severity, known) = policy.rank_of_word(word);
            if !known {
                report.note(
                    InfoCode::SeverityUnknown,
                    format!(
                        "{label}: {result_key} '{word}' is not a known severity; ranked CRITICAL"
                    ),
                );
            }
            if severity.rank() >= effective.rank() {
                let basis = if severity.rank() >= policy.threshold.rank() {
                    "config"
                } else {
                    "strict_floor"
                };
                report.fire(
                    EXIT_CRITICAL_GATE,
                    ReasonCode::FindingUnresolved,
                    format!(
                        "{label}: {result_key} '{word}' is at or above {effective} (basis={basis})"
                    ),
                );
            } else {
                report.note(
                    InfoCode::FindingBelowGate,
                    format!("{label}: {result_key} '{word}' is below {effective}"),
                );
            }
        }
    }
}

fn integrity(detail: impl Into<String>) -> SessionError {
    SessionError::Integrity(detail.into())
}

/// Custom tags and non-string keys are not plain data; the skill's
/// restricted loader refuses both.
fn reject_non_data(value: &Value, at: &str) -> Result<(), SessionError> {
    match value {
        Value::Tagged(tagged) => Err(SessionError::Invalid(format!(
            "{at}: tag '{}' is not allowed",
            tagged.tag
        ))),
        Value::Sequence(items) => items.iter().try_for_each(|item| reject_non_data(item, at)),
        Value::Mapping(map) => map.iter().try_for_each(|(key, item)| {
            let Some(key) = key.as_str() else {
                return Err(SessionError::Invalid(format!(
                    "{at}: a mapping key is not a string"
                )));
            };
            reject_non_data(item, &format!("{at}.{key}"))
        }),
        _ => Ok(()),
    }
}

fn as_mapping<'v>(value: &'v Value, at: &str) -> Result<&'v serde_yaml::Mapping, SessionError> {
    value
        .as_mapping()
        .ok_or_else(|| integrity(format!("{at} is not a mapping")))
}

fn required<'v>(
    map: &'v serde_yaml::Mapping,
    key: &str,
    at: &str,
) -> Result<&'v Value, SessionError> {
    map.get(key)
        .ok_or_else(|| integrity(format!("{at}.{key} is missing")))
}

fn key_str(key: &Value) -> Result<&str, SessionError> {
    key.as_str()
        .ok_or_else(|| SessionError::Invalid("a mapping key is not a string".to_string()))
}

fn parse_phase(key: &Value, entry: &Value) -> Result<PhaseEntry, SessionError> {
    let id = key_str(key)?;
    let at = format!("phases.{id}");
    let map = as_mapping(entry, &at)?;
    let status = required(map, "status", &at)?
        .as_str()
        .and_then(PhaseStatus::parse)
        .ok_or_else(|| integrity(format!("{at}.status is not one of the skill's statuses")))?;
    let skip_reason = match map.get("skip_reason") {
        None | Some(Value::Null) => None,
        Some(Value::String(reason)) => Some(reason.clone()),
        Some(_) => return Err(integrity(format!("{at}.skip_reason is not a string"))),
    };
    Ok(PhaseEntry {
        id: id.to_string(),
        status,
        skip_reason,
    })
}

fn parse_bag(value: &Value, at: &str) -> Result<Bag, SessionError> {
    let map = as_mapping(value, at)?;
    let mut bag = Bag::default();
    if let Some(counters) = map.get("counters").filter(|v| !v.is_null()) {
        for (name, count) in as_mapping(counters, &format!("{at}.counters"))? {
            let name = key_str(name)?;
            let count = count.as_u64().ok_or_else(|| {
                integrity(format!(
                    "{at}.counters.{name} is not a non-negative integer"
                ))
            })?;
            bag.counters.insert(name.to_string(), count);
        }
    }
    if let Some(data) = map.get("data").filter(|v| !v.is_null()) {
        for (key, item) in as_mapping(data, &format!("{at}.data"))? {
            bag.data.insert(key_str(key)?.to_string(), item.clone());
        }
    }
    Ok(bag)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::gate_config::{gate_map, severity_table};

    const PREFIX: &str = "k-full-sdlc";
    const PHASES: [&str; 12] = [
        "elicitation",
        "codebase-analysis",
        "requirements",
        "design",
        "design-review",
        "feature-splitting",
        "specs",
        "implementation",
        "code-review",
        "testing",
        "documentation",
        "final-summary",
    ];

    fn session_yaml(text: &str) -> Value {
        serde_yaml::from_str(text).expect("fixture YAML must parse")
    }

    fn allow_all_evidence(_: &str) -> bool {
        true
    }

    fn feature_facts(indent: &str) -> String {
        [
            "gate_specs_result: approved",
            "gate_specs_evidence: out/specs/login/tasks.md",
            "gate_specs_checker: user",
            "gate_code-review_result: approved",
            "gate_code-review_evidence: out/login/code-review/report.md",
            "gate_code-review_checker: user",
            "gate_testing_result: none",
            "gate_testing_evidence: out/login/testing/test-coverage-review-report.md",
            "gate_testing_checker: k-quality-assurance",
        ]
        .iter()
        .map(|line| format!("{indent}{line}\n"))
        .collect()
    }

    /// A completed k-full-sdlc session with every gate fact in place and
    /// one feature, `login`.
    fn passing() -> Value {
        let phases: String = PHASES
            .iter()
            .map(|id| {
                format!(
                    "  {id}: {{name: n, status: COMPLETED, skip_reason: null, summary: done}}\n"
                )
            })
            .collect();
        session_yaml(&format!(
            "run:
  schema_version: 1
  project_signature: sig
  run_status: completed
  counters: {{}}
  data:
    max_fix_cycles: 2
    gate_design-review_result: none
    gate_design-review_evidence: out/design/principal-engineer-review.md
    gate_design-review_checker: k-architect
    gate_feature-splitting_result: approved
    gate_feature-splitting_evidence: out/feature-split/feature-split.md
    gate_feature-splitting_checker: user
phases:
{phases}features:
  login:
    counters: {{fix_cycles_used: 0}}
    data:
{}",
            feature_facts("      ")
        ))
    }

    fn set_phase(session: &mut Value, id: &str, status: &str) {
        session["phases"][id]["status"] = Value::from(status);
    }

    fn skip_phase(session: &mut Value, id: &str) {
        set_phase(session, id, "SKIPPED");
        session["phases"][id]["skip_reason"] = Value::from("not needed");
    }

    fn set_run_status(session: &mut Value, status: &str) {
        session["run"]["run_status"] = Value::from(status);
    }

    fn set_run_data(session: &mut Value, key: &str, value: Value) {
        session["run"]["data"][key] = value;
    }

    fn set_login(session: &mut Value, key: &str, value: Value) {
        session["features"]["login"]["data"][key] = value;
    }

    fn remove_login(session: &mut Value, key: &str) {
        session["features"]["login"]["data"]
            .as_mapping_mut()
            .unwrap()
            .remove(key);
    }

    fn set_fix_cycles_used(session: &mut Value, used: u64) {
        session["features"]["login"]["counters"]["fix_cycles_used"] = Value::from(used);
    }

    fn evaluate_with(
        session: &Value,
        prefix: &str,
        threshold: Severity,
        allow_running: bool,
        evidence: &dyn Fn(&str) -> bool,
    ) -> Verdict {
        let gate_map = gate_map().unwrap();
        let policy = SeverityPolicy {
            table: severity_table().unwrap(),
            threshold,
        };
        let ctx = EvalContext {
            session_prefix: prefix,
            gate_map: &gate_map,
            policy: &policy,
            evidence_exists: evidence,
            allow_running,
        };
        evaluate_value(session, &ctx)
    }

    fn eval(session: &Value) -> Verdict {
        evaluate_with(
            session,
            PREFIX,
            Severity::Critical,
            false,
            &allow_all_evidence,
        )
    }

    fn eval_running(session: &Value) -> Verdict {
        evaluate_with(
            session,
            PREFIX,
            Severity::Critical,
            true,
            &allow_all_evidence,
        )
    }

    fn codes(verdict: &Verdict) -> Vec<&'static str> {
        verdict.reasons.iter().map(|r| r.code.code()).collect()
    }

    fn info_codes(verdict: &Verdict) -> Vec<&'static str> {
        verdict.info.iter().map(|i| i.code.code()).collect()
    }

    fn assert_verdict(verdict: &Verdict, exit: u8, code: &str) {
        assert_eq!(verdict.exit, exit, "{verdict:#?}");
        assert!(
            codes(verdict).contains(&code),
            "{code} missing from {verdict:#?}"
        );
    }

    #[test]
    fn effective_threshold_never_laxer_than_high() {
        let table = severity_table().unwrap();
        for (configured, effective) in [
            (Severity::Critical, Severity::High),
            (Severity::High, Severity::High),
            (Severity::Medium, Severity::Medium),
            (Severity::Low, Severity::Low),
            (Severity::Info, Severity::Info),
        ] {
            let policy = SeverityPolicy {
                table: table.clone(),
                threshold: configured,
            };
            assert_eq!(policy.effective_threshold(), effective, "{configured}");
        }
    }

    #[test]
    fn passing_session_exits_0() {
        let verdict = eval(&passing());
        assert_eq!(codes(&verdict), vec!["PASSED"]);
        assert_eq!(verdict.exit, 0);
    }

    #[test]
    fn v1_custom_tag_is_session_invalid() {
        let mut session = passing();
        set_run_data(&mut session, "payload", session_yaml("!python/object [ls]"));
        assert_verdict(&eval(&session), 64, "SESSION_INVALID");
    }

    #[test]
    fn v1_non_string_key_is_session_invalid() {
        let mut session = passing();
        session["run"]["data"]
            .as_mapping_mut()
            .unwrap()
            .insert(Value::from(7), Value::from("x"));
        assert_verdict(&eval(&session), 64, "SESSION_INVALID");
    }

    #[test]
    fn v2_schema_version_other_than_1() {
        let mut session = passing();
        session["run"]["schema_version"] = Value::from(2);
        assert_verdict(&eval(&session), 65, "RECORD_INTEGRITY");
    }

    #[test]
    fn v2_status_outside_the_enums() {
        let mut session = passing();
        set_phase(&mut session, "design", "DONE");
        assert_verdict(&eval(&session), 65, "RECORD_INTEGRITY");

        let mut session = passing();
        set_run_status(&mut session, "paused");
        assert_verdict(&eval(&session), 65, "RECORD_INTEGRITY");
    }

    #[test]
    fn v2_prefix_not_gated() {
        let verdict = evaluate_with(
            &passing(),
            "k-plan",
            Severity::Critical,
            false,
            &allow_all_evidence,
        );
        assert_verdict(&verdict, 65, "RECORD_INTEGRITY");
    }

    #[test]
    fn v2_gated_entry_without_phases() {
        let verdict = evaluate_with(
            &passing(),
            "k-design-doc-creation",
            Severity::Critical,
            false,
            &allow_all_evidence,
        );
        assert_verdict(&verdict, 65, "RECORD_INTEGRITY");
    }

    #[test]
    fn v2_phase_keys_differ_from_the_list() {
        let mut session = passing();
        session["phases"].as_mapping_mut().unwrap().remove("design");
        assert_verdict(&eval(&session), 65, "RECORD_INTEGRITY");
    }

    #[test]
    fn v3_completed_after_an_unfinished_phase() {
        let mut session = passing();
        set_run_status(&mut session, "in_progress");
        set_phase(&mut session, "design", "PENDING");
        assert_verdict(&eval_running(&session), 65, "PHASE_ORDER");
    }

    #[test]
    fn v3_completed_run_with_an_open_phase() {
        let mut session = passing();
        set_phase(&mut session, "final-summary", "IN_PROGRESS");
        assert_verdict(&eval(&session), 65, "PHASE_INCOMPLETE");
    }

    #[test]
    fn v3_skipped_without_a_reason() {
        let mut session = passing();
        set_phase(&mut session, "documentation", "SKIPPED");
        assert_verdict(&eval(&session), 65, "SKIP_UNEXPLAINED");
    }

    /// Skips are written at minting, so a later SKIPPED phase is not an
    /// ordering violation.
    #[test]
    fn running_session_with_a_skipped_later_phase_passes_with_allow_running() {
        let mut session = passing();
        set_run_status(&mut session, "in_progress");
        for id in &PHASES[2..] {
            set_phase(&mut session, id, "PENDING");
        }
        set_phase(&mut session, "codebase-analysis", "IN_PROGRESS");
        skip_phase(&mut session, "documentation");

        let verdict = eval_running(&session);
        assert_eq!(codes(&verdict), vec!["RUNNING"], "{verdict:#?}");
        assert_eq!(verdict.exit, 0);

        assert_verdict(&eval(&session), 65, "RUNNING");
    }

    /// A feature left blocked keeps its phase IN_PROGRESS while the run
    /// moves on; that is a halted run, not a corrupt record.
    #[test]
    fn blocked_feature_with_documentation_completed_is_halted() {
        let mut session = passing();
        set_run_status(&mut session, "in_progress");
        set_phase(&mut session, "testing", "IN_PROGRESS");
        set_phase(&mut session, "final-summary", "IN_PROGRESS");
        session["features"]["signup"] = session_yaml(&format!(
            "counters: {{fix_cycles_used: 1}}\ndata:\n{}",
            feature_facts("  ")
        ));
        let mut signup_data = session["features"]["signup"]["data"].clone();
        signup_data
            .as_mapping_mut()
            .unwrap()
            .remove("gate_testing_result");
        session["features"]["signup"]["data"] = signup_data;

        let verdict = eval_running(&session);
        assert_eq!(verdict.exit, 1, "{verdict:#?}");
        assert_eq!(codes(&verdict), vec!["HALTED"]);
    }

    #[test]
    fn unfinished_phase_outside_the_feature_span_is_still_phase_order() {
        let mut session = passing();
        set_run_status(&mut session, "in_progress");
        set_phase(&mut session, "design", "IN_PROGRESS");
        set_phase(&mut session, "final-summary", "IN_PROGRESS");
        let verdict = eval_running(&session);
        assert_verdict(&verdict, 65, "PHASE_ORDER");
        assert!(!codes(&verdict).contains(&"HALTED"));
    }

    #[test]
    fn feature_phase_held_open_with_no_features_is_phase_order() {
        let mut session = passing();
        set_run_status(&mut session, "in_progress");
        set_phase(&mut session, "testing", "IN_PROGRESS");
        set_phase(&mut session, "final-summary", "IN_PROGRESS");
        session["features"] = Value::Mapping(serde_yaml::Mapping::new());
        let verdict = eval_running(&session);
        assert_verdict(&verdict, 65, "PHASE_ORDER");
        assert!(!codes(&verdict).contains(&"HALTED"));
    }

    #[test]
    fn v4_missing_result_is_gate_missing() {
        let mut session = passing();
        remove_login(&mut session, "gate_code-review_result");
        assert_verdict(&eval(&session), 65, "GATE_MISSING");
    }

    #[test]
    fn v4_approval_other_than_approved() {
        let mut session = passing();
        set_login(&mut session, "gate_specs_result", Value::from("rejected"));
        assert_verdict(&eval(&session), 65, "APPROVAL_MISSING");
    }

    #[test]
    fn v4_evidence_rejected_by_the_check() {
        let only_reports = |path: &str| !path.ends_with("tasks.md");
        let verdict = evaluate_with(&passing(), PREFIX, Severity::Critical, false, &only_reports);
        assert_verdict(&verdict, 65, "EVIDENCE_MISSING");
        assert_eq!(codes(&verdict), vec!["EVIDENCE_MISSING"]);
    }

    #[test]
    fn v4_feature_boundary_completed_with_no_features() {
        let mut session = passing();
        session["features"] = Value::Mapping(serde_yaml::Mapping::new());
        assert_verdict(&eval(&session), 65, "GATE_MISSING");
    }

    #[test]
    fn v5_blocked_phase_is_halted() {
        let mut session = passing();
        set_run_status(&mut session, "in_progress");
        set_phase(&mut session, "documentation", "BLOCKED");
        set_phase(&mut session, "final-summary", "PENDING");
        let verdict = eval_running(&session);
        assert_eq!(codes(&verdict), vec!["HALTED"]);
        assert_eq!(verdict.exit, 1);
    }

    fn with_fix_cycles(recorded: Option<Value>, used: u64) -> Verdict {
        let mut session = passing();
        match recorded {
            Some(value) => set_run_data(&mut session, "max_fix_cycles", value),
            None => {
                session["run"]["data"]
                    .as_mapping_mut()
                    .unwrap()
                    .remove("max_fix_cycles");
            }
        }
        set_fix_cycles_used(&mut session, used);
        eval(&session)
    }

    #[test]
    fn v6_recorded_cap_of_1_lowers_the_cap() {
        assert_verdict(
            &with_fix_cycles(Some(Value::from(1)), 2),
            3,
            "BUDGET_EXCEEDED",
        );
    }

    #[test]
    fn v6_recorded_cap_of_2_allows_2() {
        assert_eq!(with_fix_cycles(Some(Value::from(2)), 2).exit, 0);
        assert_verdict(
            &with_fix_cycles(Some(Value::from(2)), 3),
            3,
            "BUDGET_EXCEEDED",
        );
    }

    #[test]
    fn v6_recorded_cap_above_2_is_clamped() {
        let verdict = with_fix_cycles(Some(Value::from(5)), 3);
        assert_verdict(&verdict, 3, "BUDGET_EXCEEDED");
        assert!(info_codes(&verdict).contains(&"FIX_CAP_CLAMPED"));

        let verdict = with_fix_cycles(Some(Value::from(5)), 2);
        assert_eq!(verdict.exit, 0);
        assert!(info_codes(&verdict).contains(&"FIX_CAP_CLAMPED"));
    }

    #[test]
    fn v6_absent_cap_is_2() {
        assert_eq!(with_fix_cycles(None, 2).exit, 0);
        assert_verdict(&with_fix_cycles(None, 3), 3, "BUDGET_EXCEEDED");
    }

    #[test]
    fn v6_non_integer_cap_is_2() {
        assert_eq!(with_fix_cycles(Some(Value::from("two")), 2).exit, 0);
        assert_verdict(
            &with_fix_cycles(Some(Value::from("two")), 3),
            3,
            "BUDGET_EXCEEDED",
        );
    }

    #[test]
    fn v7_unknown_word_ranks_critical() {
        let mut session = passing();
        set_run_data(
            &mut session,
            "gate_design-review_result",
            Value::from("BLOCKER"),
        );
        let verdict = eval(&session);
        assert_verdict(&verdict, 2, "FINDING_UNRESOLVED");
        assert!(info_codes(&verdict).contains(&"SEVERITY_UNKNOWN"));
    }

    #[test]
    fn v7_important_gates_under_the_strict_floor() {
        let mut session = passing();
        set_login(
            &mut session,
            "gate_testing_result",
            Value::from("IMPORTANT"),
        );
        let verdict = eval(&session);
        assert_verdict(&verdict, 2, "FINDING_UNRESOLVED");
        assert!(
            verdict.reasons[0].detail.contains("basis=strict_floor"),
            "{verdict:#?}"
        );
    }

    #[test]
    fn v7_suggestion_is_below_the_gate() {
        let mut session = passing();
        set_run_data(
            &mut session,
            "gate_design-review_result",
            Value::from("SUGGESTION"),
        );
        let verdict = eval(&session);
        assert_eq!(verdict.exit, 0, "{verdict:#?}");
        assert!(info_codes(&verdict).contains(&"FINDING_BELOW_GATE"));
    }

    #[test]
    fn orchestrator_as_checker_is_noted_without_changing_the_exit() {
        let mut session = passing();
        set_run_data(
            &mut session,
            "gate_design-review_checker",
            Value::from("konductor"),
        );
        let verdict = eval(&session);
        assert_eq!(verdict.exit, 0);
        assert_eq!(info_codes(&verdict), vec!["SAME_TYPE_CHECKER"]);
    }

    #[test]
    fn v8_skipped_boundary_exits_6() {
        let mut session = passing();
        skip_phase(&mut session, "design-review");
        session["run"]["data"]
            .as_mapping_mut()
            .unwrap()
            .retain(|key, _| !key.as_str().unwrap().starts_with("gate_design-review_"));
        let verdict = eval(&session);
        assert_verdict(&verdict, 6, "PASSED");
        assert!(info_codes(&verdict).contains(&"PHASE_SKIPPED"));
    }

    #[test]
    fn v9_running_needs_allow_running() {
        let mut session = passing();
        set_run_status(&mut session, "in_progress");
        set_phase(&mut session, "final-summary", "IN_PROGRESS");
        assert_verdict(&eval(&session), 65, "RUNNING");
        assert_verdict(&eval_running(&session), 0, "RUNNING");
    }

    #[test]
    fn every_firing_row_is_reported_and_the_first_sets_the_exit() {
        let mut session = passing();
        remove_login(&mut session, "gate_code-review_result");
        set_fix_cycles_used(&mut session, 3);
        set_login(&mut session, "gate_testing_result", Value::from("CRITICAL"));
        let verdict = eval(&session);
        assert_eq!(verdict.exit, 65);
        assert_eq!(
            codes(&verdict),
            vec!["GATE_MISSING", "BUDGET_EXCEEDED", "FINDING_UNRESOLVED"]
        );
    }

    #[test]
    fn strict_floor_holds_for_every_threshold_and_word() {
        let table = severity_table().unwrap();
        let mut words: Vec<String> = Severity::ALL.iter().map(|s| s.to_string()).collect();
        words.extend(table.entries.iter().flat_map(|e| e.aliases.clone()));
        words.push("UNLISTED".to_string());

        for threshold in Severity::ALL {
            let effective_rank = threshold.rank().min(Severity::High.rank());
            for word in &words {
                let word_rank = match table.rank_of_word(word) {
                    WordRank::Known(severity) => severity.rank(),
                    WordRank::Unknown => Severity::Critical.rank(),
                };
                let mut session = passing();
                set_run_data(
                    &mut session,
                    "gate_design-review_result",
                    Value::from(word.as_str()),
                );
                let verdict =
                    evaluate_with(&session, PREFIX, threshold, false, &allow_all_evidence);
                let expected = if word_rank >= effective_rank { 2 } else { 0 };
                assert_eq!(verdict.exit, expected, "threshold {threshold}, word {word}");
            }
        }
    }
}
