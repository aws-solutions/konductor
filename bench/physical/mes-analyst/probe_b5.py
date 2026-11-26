# SPDX-License-Identifier: Apache-2.0
"""One real MES brief through the bench's capped Sonnet 5.5 model, under a dollar ceiling, with a progress log.

Run from your terminal, where bench-strands can sign:
  AWS_PROFILE=bench-strands python3 probe_b5.py <cap_usd> <scratch_dir> [brief_id]

brief_id defaults to B5. Refuses to run without a positive cap. The CappedModel refuses any call that could
pass the cap, before it is made.

Every event is appended to <scratch_dir>/probe-runs.log as it happens:
  started     the brief and cap, before any call
  call        each model call, with its running spend and reserve
  call-done   each model call's tokens and spend once it returns
  heartbeat   every HEARTBEAT_SECS while running: PID, last event, calls and spend so far
  stopped     on SIGINT or SIGTERM: the spend so far, before the process exits
  finished    the result, calls, tokens and USD spent
  failed      the error and the USD spent so far

Only one probe may write to a scratch folder at a time. A lock file (probe.lock) enforces that. A lock held by a
live process refuses the new run. A lock left by a dead process is replaced.
"""
import asyncio
import datetime
import os
import signal
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH_STRANDS = os.path.normpath(os.path.join(HERE, "..", "strands"))
sys.path.insert(0, BENCH_STRANDS)
sys.path.insert(0, HERE)

HEARTBEAT_SECS = 60
LOCK_NAME = "probe.lock"
LOG_NAME = "probe-runs.log"


class Trace:
    """Receives the CappedModel's trace events and forwards each one to the progress log as it happens."""

    def __init__(self, on_event):
        self.on_event = on_event

    def write(self, event, **fields):
        self.on_event(event, fields)


def _log(scratch, text):
    stamp = datetime.datetime.now().strftime("%H:%M:%S")
    with open(os.path.join(scratch, LOG_NAME), "a", encoding="utf-8") as f:
        f.write("%s %s\n" % (stamp, text))
    print(text, flush=True)


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _take_lock(scratch):
    """Create probe.lock with this PID. Refuse if a live process holds it; replace a stale one."""
    path = os.path.join(scratch, LOCK_NAME)
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                other = int(f.read().strip() or 0)
        except (OSError, ValueError):
            other = 0
        if other and other != os.getpid() and _pid_alive(other):
            raise SystemExit("another probe (pid %d) is writing to %s; refusing to start" % (other, scratch))
    with open(path, "w", encoding="utf-8") as f:
        f.write("%d\n" % os.getpid())
    return path


class _Progress:
    """Tracks the last event and running spend, for the heartbeat and the stop record."""

    def __init__(self, scratch):
        self.scratch = scratch
        self.last = "none yet"
        self.spent = 0.0
        self.calls = 0
        self.lock = threading.Lock()

    def on_event(self, event, fields):
        with self.lock:
            if event == "spend":
                self.calls = fields.get("call", self.calls)
                self.spent = fields.get("spentUsd", self.spent)
                self.last = "call %s reserve up to $%.4f" % (fields.get("call"), fields.get("reservedUsd", 0.0))
                _log(self.scratch, "call   %s spent-so-far=$%.6f reserved=$%.6f" % (
                    fields.get("call"), fields.get("spentUsd", 0.0), fields.get("reservedUsd", 0.0)))
            elif event == "spend_cap":
                self.last = "refused by cap"
                _log(self.scratch, "refused by cap: capUsd=%s spentUsd=%.6f nextCallReserveUsd=%.6f" % (
                    fields.get("capUsd"), fields.get("spentUsd", 0.0), fields.get("nextCallReserveUsd", 0.0)))
            elif event == "usage":
                self.last = "usage"
                self.spent = fields.get("costUsd", self.spent)
                _log(self.scratch, "usage  inputTokens=%s outputTokens=%s calls=%s costUsd=%.6f" % (
                    fields.get("inputTokens"), fields.get("outputTokens"), fields.get("modelCalls"),
                    fields.get("costUsd", 0.0)))


CALL_TIMEOUT_SECS = 120


class CallTimedOut(RuntimeError):
    """A model call produced no event for CALL_TIMEOUT_SECS. The run stops; the spend so far is logged."""


MAX_CALLS = 12  # a brief needs about 4-5 calls; more than this is a loop, so the run stops


class CallLimitReached(RuntimeError):
    """The run made MAX_CALLS model calls. The run stops; the spend so far is logged."""


class TimedModel:
    """Wraps a capped model so no single call can stall the run, and no run can loop forever.

    Each stream event must arrive within CALL_TIMEOUT_SECS, or the call raises CallTimedOut. Each call logs its
    start and end with its duration, so a stall shows which call it was. After MAX_CALLS calls the run raises
    CallLimitReached. The wrapped model's spend and calls are unchanged."""

    def __init__(self, inner, scratch, timeout_secs=CALL_TIMEOUT_SECS, max_calls=MAX_CALLS):
        self.inner = inner
        self.scratch = scratch
        self.timeout_secs = timeout_secs
        self.max_calls = max_calls
        self.started = 0

    def __getattr__(self, name):
        return getattr(self.inner, name)

    async def stream(self, *args, **kwargs):
        self.started += 1
        n = self.started
        if n > self.max_calls:
            _log(self.scratch, "call-limit: call %d would exceed %d calls; stopping" % (n, self.max_calls))
            raise CallLimitReached("more than %d calls" % self.max_calls)
        _log(self.scratch, "call-start %d" % n)
        began = asyncio.get_running_loop().time()
        events = self.inner.stream(*args, **kwargs).__aiter__()
        count = 0
        while True:
            try:
                event = await asyncio.wait_for(events.__anext__(), self.timeout_secs)
            except StopAsyncIteration:
                break
            except asyncio.TimeoutError as e:
                _log(self.scratch, "call-timeout %d after %.1fs with %d events" % (
                    n, asyncio.get_running_loop().time() - began, count))
                raise CallTimedOut("no event for %ds" % self.timeout_secs) from e
            count += 1
            yield event
        _log(self.scratch, "call-end %d in %.1fs with %d events" % (
            n, asyncio.get_running_loop().time() - began, count))


def _heartbeat(progress, stop):
    while not stop.wait(HEARTBEAT_SECS):
        with progress.lock:
            _log(progress.scratch, "heartbeat pid=%d last=%s calls=%d spent=$%.6f" % (
                os.getpid(), progress.last, progress.calls, progress.spent))


def main(cap_usd, scratch, brief_id="B5"):
    if not cap_usd > 0:
        raise SystemExit("a positive dollar cap is required")
    import launch
    from mes_analyst import agent, briefs

    if brief_id not in briefs.BRIEFS:
        raise SystemExit("unknown brief %r; known: %s" % (brief_id, ", ".join(sorted(briefs.BRIEFS))))

    lock = _take_lock(scratch)
    progress = _Progress(scratch)
    stop = threading.Event()

    def _on_signal(signum, _frame):
        _log(scratch, "stopped signal=%s calls=%d spent=$%.6f last=%s" % (
            signal.Signals(signum).name, progress.calls, progress.spent, progress.last))
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)
    threading.Thread(target=_heartbeat, args=(progress, stop), daemon=True).start()

    try:
        trace = Trace(progress.on_event)
        _, capped = launch.model_of("bedrock:global.anthropic.claude-sonnet-5-5", cap_usd, trace)
        db = os.path.join(scratch, "mes", "s7.db")
        out = tempfile.mkdtemp(prefix="probe-%s-" % brief_id.lower(), dir=scratch)
        _log(scratch, "started brief=%s cap=%.2f pid=%d out=%s" % (brief_id, cap_usd, os.getpid(), out))
        try:
            result = agent.run_brief(TimedModel(capped, scratch), brief_id, db, out)
        except BaseException as e:  # record the failure and the spend so far, then re-raise
            _log(scratch, "failed brief=%s error=%s spent=%.6f calls=%d" % (
                brief_id, type(e).__name__, capped.spent_usd, capped.calls))
            raise
        _log(scratch, "finished brief=%s pass=%s violations=%s calls=%d in=%d out=%d spent=%.6f fields=%s" % (
            brief_id, result["pass"], result["violations"], capped.calls, capped.input_tokens,
            capped.output_tokens, capped.spent_usd, {k: v["ok"] for k, v in result["score"]["fields"].items()}))
    finally:
        stop.set()
        if os.path.exists(lock):
            os.remove(lock)


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        raise SystemExit("usage: probe_b5.py <cap_usd> <scratch_dir> [brief_id]")
    main(float(sys.argv[1]), sys.argv[2], *sys.argv[3:4])
