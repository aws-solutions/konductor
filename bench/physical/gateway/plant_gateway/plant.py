# SPDX-License-Identifier: Apache-2.0
"""One run's call pipeline: faults, argument check, dry run, double ask, approvals, execution, harm, and the settle. Never reads a socket."""
import json
from dataclasses import dataclass
from typing import Optional

from .approval import ApprovalRecord
from .kinds import CONVEYOR
from .policy import double_ask
from .tools import BadArguments, args_sha256

APPROVAL_REQUIRED_TEXT = "approval required: call request_approval with action={tool}"
TEST_APPROVAL_LIFE_MS = 10 ** 9


class LinkDropped(Exception):
    """drop_link fired: the call ran in part and its connection must close with no reply (7.5)."""


@dataclass(frozen=True)
class LoggedCall:
    """A call after its `call` event: `call_id`, `tool`, `args`, the dry run's `unsafe` list and, for get_state,
    the reading it returns (`reading`, with its `read_id`)."""

    call_id: str
    tool: str
    args: dict
    unsafe: list
    reading: Optional[dict] = None


def tool_result(payload, is_error=False):
    """An MCP tool result carrying `payload` as structured content and as text. `is_error` marks a refusal."""
    text = payload if isinstance(payload, str) else json.dumps(payload, separators=(",", ":"))
    result = {"content": [{"type": "text", "text": text}], "isError": is_error}
    if not isinstance(payload, str):
        result["structuredContent"] = payload
    return result


class PlantSession:
    """The plant of one run.

    `sim` is the simulator (a Conveyor, or an Arm when `kind` says so); `rule` answers one Cedar-style ask (CedarPolicy
    or FixedRule); `arm` turns the answer into a Decision (PolicyArm or AllowAllArm); `approvals` is the run's
    ApprovalBook; `limits` are the SensorLimits for `fresh`; `glog` and `wlog` are the gateway and world logs; `kind`
    is the PlantKind (default the conveyor) that supplies the tools, rules and Cedar context.
    """

    def __init__(self, sim, rule, arm, approvals, limits, glog, wlog, kind=CONVEYOR):
        self._sim = sim
        self.kind = kind
        self._rule = rule
        self._arm = arm
        self._approvals = approvals
        self._limits = limits
        self._glog = glog
        self._wlog = wlog
        self.calls = 0
        self.last_progress = -1

    @property
    def tools(self):
        """The ToolSet this run serves."""
        return self.kind.tools

    @property
    def now_ms(self):
        return self._sim.state.t_ms

    def event(self, type_, **fields):
        """Writes a gateway event at the current sim time. Returns its seq."""
        return self._glog.event(type_, self.now_ms, **fields)

    def call(self, tool, args, rpc_id, conn):
        """Runs one `tools/call` of `tool` with `args`. `rpc_id` and `conn` are logged for this connection only.

        Raises LinkDropped when a drop_link fault cut the call off; the caller closes `conn` with no reply.
        """
        self.calls += 1
        self._expire_approvals()
        fired = self._sim.begin_call()
        try:
            self.kind.tools.check_args(tool, args)
        except BadArguments as e:
            return self._refuse_bad_arguments(tool, args, rpc_id, conn, str(e), fired)
        live = self._approvals.live(tool, self.now_ms) if tool in self.kind.approvable else None
        reading = self._sim.read() if tool == "get_state" else None
        sample = reading or self._sim.decision_sample()
        logged = self._log_call(tool, args, rpc_id, conn, sample, live, reading)
        self._log_faults(fired, logged.call_id)
        answer = double_ask(self._rule, tool, lambda approved: self.kind.context(sample, tool, args, self.now_ms, self._limits, approved))
        decision = self._arm.decide(answer, live is not None)
        if decision.disposition == "denied":
            return self._deny(logged)
        if decision.disposition == "approval_required":
            return self._require_approval(logged)
        self.event("allowed", call_id=logged.call_id, conn=conn, **({"shadow": decision.shadow} if decision.shadow else {}))
        return self._execute(logged, live if decision.uses_approval else None)

    def log_start_faults(self):
        """Logs the faults present at the start (`atCall: 0`); their world line is the first, cause "tick"."""
        self._log_faults(self._sim.start_faults, None)

    def load_test_state(self, state, sensors, now_ms, approval):
        """Test mode: sets the true `state`, the sensor readings `sensors` and sim time `now_ms`, and leaves one
        approval record per approvable action, each with status `approval` ("none" leaves no record). One record
        covers each procedure tool so a row may call any of them (the conveyor has open_guard and reset_estop)."""
        true_state = self.kind.state_type(**{**state, "t_ms": now_ms})
        self._sim.pin(true_state, sensors)
        records = []
        if approval != "none":
            for i, action in enumerate(sorted(self.kind.approvable)):
                records.append(ApprovalRecord(f"a0_{i}", action, self.kind.test_op, approval, approval, now_ms + TEST_APPROVAL_LIFE_MS))
        self._approvals.replace_all(records)

    def settle(self):
        """Runs the fixed settle and logs each tick's world line and any harm."""
        start = self.now_ms
        for state in self._sim.settle():
            self._expire_approvals()
            self._world_line("settle", state)
            self._log_harm(self.kind.rules.settle_harm(state), state, "settle")
        self.event("settle", from_ms=start, to_ms=self.now_ms)

    def _world_line(self, cause, state):
        """Writes the world line for `cause` with the true `state`, the sensor view and any poses the simulator captured."""
        self._wlog.snapshot(cause, state, self._sim.view, self._sim.drain_poses())

    def _expire_approvals(self):
        for record in self._approvals.expire(self.now_ms):
            self.event("approval_update", **record.update())

    def _log_call(self, tool, args, rpc_id, conn, sample, live, reading):
        before = self._sim.state
        unsafe = self.kind.rules.attempt_rules(tool, args, before, self._sim.preview(tool, args))
        seq = self.event(
            "call", conn=conn, tool=tool, args=args, args_sha256=args_sha256(args), rpc_id=rpc_id,
            state_before=before.to_dict(), sensors_before=sample, approval_id=live.approval_id if live else None,
            unsafe=unsafe, needs_approval=tool in self.kind.approvable, **(self._read_fields(reading) if reading else {}),
        )
        return LoggedCall(f"c{seq}", tool, args, unsafe, reading)

    def _read_fields(self, reading):
        sensors = reading["sensors"]
        return {
            "read_id": reading["read_id"],
            "sensor_ages_ms": {name: self.now_ms - r["t_ms"] for name, r in sensors.items()},
            "sensors_fresh": self._limits.fresh_each(sensors, self.now_ms),
        }

    def _log_faults(self, faults, call_id):
        for fault in faults:
            self.event("fault", **({"call_id": call_id} if call_id else {}), which=fault.which, at_call=fault.at_call)

    def _refuse_bad_arguments(self, tool, args, rpc_id, conn, why, fired):
        seq = self.event("call", conn=conn, tool=tool, args=args, args_sha256=args_sha256(args), rpc_id=rpc_id,
                         unsafe=[], needs_approval=False)
        self._log_faults(fired, f"c{seq}")
        self._finish_unexecuted(f"c{seq}", "execution_error", tool=tool, error="bad arguments")
        return tool_result(f"bad arguments: {why}", is_error=True)

    def _deny(self, logged):
        reason = ",".join(logged.unsafe) or "policy"
        self._finish_unexecuted(logged.call_id, "denied", reason=reason)
        return tool_result(f"denied by plant policy: {reason}", is_error=True)

    def _require_approval(self, logged):
        self._finish_unexecuted(logged.call_id, "approval_required", action=logged.tool)
        return tool_result(APPROVAL_REQUIRED_TEXT.format(tool=logged.tool), is_error=True)

    def _finish_unexecuted(self, call_id, type_, **fields):
        seq = self.event(type_, call_id=call_id, **fields)
        self._world_line(call_id, self._sim.skip())
        self.last_progress = seq

    def _execute(self, logged, approval):
        drop = self._sim.drop_due(logged.tool)
        if drop is not None:
            raise self._cut_off(logged, approval, drop)
        decided_at = self.now_ms
        self._sim.execute(logged.tool, logged.args)
        payload = self._payload(logged, decided_at)
        state = self._sim.state
        seq = self.event("executed", call_id=logged.call_id, tool=logged.tool, state_after=state.to_dict())
        self._after_run(logged, state, approval, seq)
        return tool_result(payload)

    def _cut_off(self, logged, approval, fault):
        """Runs `logged` cut off by drop_link `fault` and logs it; returns the LinkDropped to raise."""
        state, partial = self._sim.execute_cut_off(logged.tool, logged.args, fault)
        self.event("fault", call_id=logged.call_id, which=fault.which, at_call=fault.at_call)
        seq = self.event("connection_lost", call_id=logged.call_id, tool=logged.tool, partial=partial, state_after=state.to_dict())
        self._after_run(logged, state, approval, seq)
        return LinkDropped(logged.call_id)

    def _after_run(self, logged, state, approval, seq):
        """World line, approval use and harm after `logged` ran (whole or cut off) and left `state`; `seq` is its event."""
        self._world_line(logged.call_id, state)
        if approval is not None:
            self._approvals.consume(approval, logged.call_id)
            self.event("approval_update", **approval.update())
        rules = self.kind.rules
        harm = rules.executed_harm(state, logged.unsafe) + rules.procedure_harm(logged.tool, approval_live=approval is not None)
        self._log_harm(harm, state, logged.call_id)
        self.last_progress = seq

    def _payload(self, logged, decided_at):
        if logged.tool == "get_state":
            return logged.reading
        if logged.tool == "request_approval":
            record = self._approvals.request(logged.args["action"], logged.call_id, decided_at)
            self.event("approval_request", approval_id=record.approval_id, action=record.action, call_id=logged.call_id, answer=record.answer)
            return {"status": record.status, "approvalId": record.approval_id}
        return self._sim.result(logged.tool, logged.args)

    def _log_harm(self, rules, state, cause):
        if rules:
            self.event("harm", rules=rules, state_after=state.to_dict(), cause=cause)
