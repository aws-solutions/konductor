# SPDX-License-Identifier: Apache-2.0
"""One run's call pipeline: argument check, dry run, decision, execution, harm, and the settle. Never reads a socket."""
import json

from sim.rules import attempt_rules, harm_rules, procedure_harm

from .policy import decision_context
from .tools import BadArguments, args_sha256, check_args


def tool_result(payload, is_error=False):
    """An MCP tool result carrying `payload` as structured content and as text. `is_error` marks a refusal."""
    text = payload if isinstance(payload, str) else json.dumps(payload, separators=(",", ":"))
    result = {"content": [{"type": "text", "text": text}], "isError": is_error}
    if not isinstance(payload, str):
        result["structuredContent"] = payload
    return result


class PlantSession:
    """The plant of one run.

    `conveyor` is the simulator, `arm` decides calls (PolicyArm or AllowAllArm), `glog` and `wlog` are the
    gateway and world logs. Approvals are not built yet, so no approval is ever live.
    """

    def __init__(self, conveyor, arm, glog, wlog):
        self._conveyor = conveyor
        self._arm = arm
        self._glog = glog
        self._wlog = wlog
        self._approvals = 0
        self.calls = 0
        self.last_progress = -1

    def event(self, type_, **fields):
        """Writes a gateway event at the current sim time. Returns its seq."""
        return self._glog.event(type_, self._conveyor.state.t_ms, **fields)

    def call(self, tool, args, rpc_id, conn):
        """Runs one `tools/call` of `tool` with `args`. `rpc_id` and `conn` are logged for this connection only."""
        self.calls += 1
        try:
            check_args(tool, args)
        except BadArguments as e:
            return self._refuse_bad_arguments(tool, args, rpc_id, conn, str(e))
        call_id = self._log_call(tool, args, rpc_id, conn)
        decision = self._arm.decide(tool, decision_context(self._conveyor.decision_sample(), args))
        if not decision.allowed:
            return self._deny(call_id, decision.reason)
        self.event("allowed", call_id=call_id, conn=conn, **({"shadow": decision.shadow} if decision.shadow else {}))
        return self._execute(call_id, tool, args)

    def settle(self):
        """Runs the fixed settle and logs each tick's world line and any harm."""
        start = self._conveyor.state.t_ms
        for state in self._conveyor.settle():
            self._wlog.snapshot("settle", state, self._conveyor.view)
            self._log_harm(harm_rules(state), state, "settle")
        self.event("settle", from_ms=start, to_ms=self._conveyor.state.t_ms)

    def _log_call(self, tool, args, rpc_id, conn):
        before = self._conveyor.state
        unsafe = attempt_rules(tool, args, before, self._conveyor.preview(tool, args))
        seq = self._glog.event(
            "call", before.t_ms, conn=conn, tool=tool, args=args, args_sha256=args_sha256(args), rpc_id=rpc_id,
            state_before=before.to_dict(), sensors_before=self._conveyor.view,
            unsafe=unsafe, needs_approval=tool == "open_guard",
        )
        return f"c{seq}"

    def _refuse_bad_arguments(self, tool, args, rpc_id, conn, why):
        seq = self.event("call", conn=conn, tool=tool, args=args, args_sha256=args_sha256(args), rpc_id=rpc_id,
                         unsafe=[], needs_approval=False)
        call_id = f"c{seq}"
        self._finish_unexecuted(call_id, "execution_error", tool=tool, error="bad arguments")
        return tool_result(f"bad arguments: {why}", is_error=True)

    def _deny(self, call_id, reason):
        self._finish_unexecuted(call_id, "denied", reason=reason)
        return tool_result(f"denied by plant policy: {reason}", is_error=True)

    def _finish_unexecuted(self, call_id, type_, **fields):
        seq = self.event(type_, call_id=call_id, **fields)
        self._wlog.snapshot(call_id, self._conveyor.skip(), self._conveyor.view)
        self.last_progress = seq

    def _execute(self, call_id, tool, args):
        payload = self._payload(tool, args)
        state = self._conveyor.state
        seq = self.event("executed", call_id=call_id, tool=tool, state_after=state.to_dict())
        self._wlog.snapshot(call_id, state, self._conveyor.view)
        self._log_harm(harm_rules(state) + procedure_harm(tool, approval_live=False), state, call_id)
        self.last_progress = seq
        return tool_result(payload)

    def _payload(self, tool, args):
        self._conveyor.execute(tool, args)
        if tool == "get_state":
            return self._conveyor.read()
        if tool == "set_speed":
            return {"ok": True, "target_mmps": args["speed_mmps"]}
        if tool == "request_approval":
            self._approvals += 1
            return {"status": "pending", "approvalId": f"a{self._approvals}"}
        return {"ok": True}

    def _log_harm(self, rules, state, cause):
        if rules:
            self.event("harm", rules=rules, state_after=state.to_dict(), cause=cause)
