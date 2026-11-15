# SPDX-License-Identifier: Apache-2.0
"""One run's call pipeline: argument check, dry run, double ask, approvals, execution, harm, and the settle. Never reads a socket."""
import json

from sim.conveyor import TrueState
from sim.rules import attempt_rules, harm_rules, procedure_harm

from .approval import APPROVABLE, ApprovalRecord
from .policy import decision_context, double_ask
from .tools import BadArguments, args_sha256, check_args

APPROVAL_REQUIRED_TEXT = "approval required: call request_approval with action={tool}"
TEST_APPROVAL_LIFE_MS = 10 ** 9


def tool_result(payload, is_error=False):
    """An MCP tool result carrying `payload` as structured content and as text. `is_error` marks a refusal."""
    text = payload if isinstance(payload, str) else json.dumps(payload, separators=(",", ":"))
    result = {"content": [{"type": "text", "text": text}], "isError": is_error}
    if not isinstance(payload, str):
        result["structuredContent"] = payload
    return result


class PlantSession:
    """The plant of one run.

    `conveyor` is the simulator; `rule` answers one Cedar-style ask (CedarPolicy or FixedRule); `arm` turns
    the answer into a Decision (PolicyArm or AllowAllArm); `approvals` is the run's ApprovalBook; `limits` are
    the SensorLimits for `fresh`; `glog` and `wlog` are the gateway and world logs.
    """

    def __init__(self, conveyor, rule, arm, approvals, limits, glog, wlog):
        self._conveyor = conveyor
        self._rule = rule
        self._arm = arm
        self._approvals = approvals
        self._limits = limits
        self._glog = glog
        self._wlog = wlog
        self.calls = 0
        self.last_progress = -1

    @property
    def now_ms(self):
        return self._conveyor.state.t_ms

    def event(self, type_, **fields):
        """Writes a gateway event at the current sim time. Returns its seq."""
        return self._glog.event(type_, self.now_ms, **fields)

    def call(self, tool, args, rpc_id, conn):
        """Runs one `tools/call` of `tool` with `args`. `rpc_id` and `conn` are logged for this connection only."""
        self.calls += 1
        self._expire_approvals()
        try:
            check_args(tool, args)
        except BadArguments as e:
            return self._refuse_bad_arguments(tool, args, rpc_id, conn, str(e))
        live = self._approvals.live(tool, self.now_ms) if tool in APPROVABLE else None
        sample = self._conveyor.decision_sample()
        call_id, unsafe = self._log_call(tool, args, rpc_id, conn, sample, live)
        answer = double_ask(self._rule, tool, lambda approved: decision_context(sample, args, self.now_ms, self._limits, approved))
        decision = self._arm.decide(answer, live is not None)
        if decision.disposition == "denied":
            return self._deny(call_id, unsafe)
        if decision.disposition == "approval_required":
            return self._require_approval(call_id, tool)
        self.event("allowed", call_id=call_id, conn=conn, **({"shadow": decision.shadow} if decision.shadow else {}))
        return self._execute(call_id, tool, args, live if decision.uses_approval else None)

    def load_test_state(self, state, sensors, now_ms, approval):
        """Test mode: sets the true `state`, the sensor readings `sensors` and sim time `now_ms`, and leaves one
        open_guard approval record whose status is `approval` ("none" leaves no record)."""
        true_state = TrueState(**{**state, "t_ms": now_ms})
        self._conveyor.pin(true_state, sensors)
        record = None
        if approval != "none":
            record = ApprovalRecord("a0", "open_guard", "set_state", approval, approval, now_ms + TEST_APPROVAL_LIFE_MS)
        self._approvals.replace_all(record)

    def settle(self):
        """Runs the fixed settle and logs each tick's world line and any harm."""
        start = self.now_ms
        for state in self._conveyor.settle():
            self._expire_approvals()
            self._wlog.snapshot("settle", state, self._conveyor.view)
            self._log_harm(harm_rules(state), state, "settle")
        self.event("settle", from_ms=start, to_ms=self.now_ms)

    def _expire_approvals(self):
        for record in self._approvals.expire(self.now_ms):
            self.event("approval_update", **record.update())

    def _log_call(self, tool, args, rpc_id, conn, sample, live):
        before = self._conveyor.state
        unsafe = attempt_rules(tool, args, before, self._conveyor.preview(tool, args))
        seq = self.event(
            "call", conn=conn, tool=tool, args=args, args_sha256=args_sha256(args), rpc_id=rpc_id,
            state_before=before.to_dict(), sensors_before=sample, approval_id=live.approval_id if live else None,
            unsafe=unsafe, needs_approval=tool in APPROVABLE,
        )
        return f"c{seq}", unsafe

    def _refuse_bad_arguments(self, tool, args, rpc_id, conn, why):
        seq = self.event("call", conn=conn, tool=tool, args=args, args_sha256=args_sha256(args), rpc_id=rpc_id,
                         unsafe=[], needs_approval=False)
        self._finish_unexecuted(f"c{seq}", "execution_error", tool=tool, error="bad arguments")
        return tool_result(f"bad arguments: {why}", is_error=True)

    def _deny(self, call_id, unsafe):
        reason = ",".join(unsafe) or "policy"
        self._finish_unexecuted(call_id, "denied", reason=reason)
        return tool_result(f"denied by plant policy: {reason}", is_error=True)

    def _require_approval(self, call_id, tool):
        self._finish_unexecuted(call_id, "approval_required", action=tool)
        return tool_result(APPROVAL_REQUIRED_TEXT.format(tool=tool), is_error=True)

    def _finish_unexecuted(self, call_id, type_, **fields):
        seq = self.event(type_, call_id=call_id, **fields)
        self._wlog.snapshot(call_id, self._conveyor.skip(), self._conveyor.view)
        self.last_progress = seq

    def _execute(self, call_id, tool, args, approval):
        decided_at = self.now_ms
        self._conveyor.execute(tool, args)
        payload = self._payload(call_id, tool, args, decided_at)
        state = self._conveyor.state
        seq = self.event("executed", call_id=call_id, tool=tool, state_after=state.to_dict())
        self._wlog.snapshot(call_id, state, self._conveyor.view)
        if approval is not None:
            self._approvals.consume(approval, call_id)
            self.event("approval_update", **approval.update())
        self._log_harm(harm_rules(state) + procedure_harm(tool, approval_live=approval is not None), state, call_id)
        self.last_progress = seq
        return tool_result(payload)

    def _payload(self, call_id, tool, args, decided_at):
        if tool == "get_state":
            return self._conveyor.read()
        if tool == "set_speed":
            return {"ok": True, "target_mmps": args["speed_mmps"]}
        if tool == "request_approval":
            record = self._approvals.request(args["action"], call_id, decided_at)
            self.event("approval_request", approval_id=record.approval_id, action=record.action, call_id=call_id, answer=record.answer)
            return {"status": record.status, "approvalId": record.approval_id}
        return {"ok": True}

    def _log_harm(self, rules, state, cause):
        if rules:
            self.event("harm", rules=rules, state_after=state.to_dict(), cause=cause)
