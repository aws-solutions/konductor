# SPDX-License-Identifier: Apache-2.0
"""Append-only JSONL run logs with gapless seq and a running SHA-256. The gateway is the only writer; never rewrites a line."""
import errno
import hashlib
import json
import os

from .limits import LimitExceeded

LOG_VERSION = 1
OPEN_FLAGS = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_APPEND | os.O_CLOEXEC | getattr(os, "O_NOFOLLOW", 0)


class RunLog:
    """One log file of one run.

    `path` must not exist yet. `run_id` goes on every line. `wall_clock` returns the `t_wall` text and is
    information only. Each line gets the next `seq`, starting at 0.
    """

    def __init__(self, path, run_id, wall_clock):
        self._fd = os.open(path, OPEN_FLAGS, 0o600)
        self._run_id = run_id
        self._wall_clock = wall_clock
        self._hash = hashlib.sha256()
        self.lines = 0

    @property
    def last_seq(self):
        return self.lines - 1

    @property
    def sha256(self):
        return self._hash.hexdigest()

    def write(self, record, t_sim_ms):
        """Appends `record` with seq, runId, t_sim_ms and t_wall. Returns the seq it got.

        Raises LimitExceeded("log_size") when the file-size rlimit stops the write.
        """
        line = {"seq": self.lines, "runId": self._run_id, "t_sim_ms": t_sim_ms, "t_wall": self._wall_clock(), **record}
        data = (json.dumps(line, separators=(",", ":")) + "\n").encode("utf-8")
        self._write_all(data)
        self._hash.update(data)
        self.lines += 1
        return line["seq"]

    def close(self):
        os.close(self._fd)

    def _write_all(self, data):
        # SIGXFSZ is ignored by the gateway, so passing RLIMIT_FSIZE shows up here as EFBIG or a short write.
        try:
            written = os.write(self._fd, data)
        except OSError as e:
            if e.errno == errno.EFBIG:
                raise LimitExceeded("log_size") from None
            raise
        if written != len(data):
            raise LimitExceeded("log_size")


class GatewayLog(RunLog):
    """`gateway.jsonl`: decision events (9.1). `type` names the event."""

    def event(self, type_, t_sim_ms, **fields):
        """Writes one event of `type_` with `fields`. Returns its seq."""
        return self.write({"type": type_, **fields}, t_sim_ms)


class WorldLog(RunLog):
    """`world.jsonl`: one line per state change (9.2). `cause` is a call_id, "tick" or "settle"."""

    def snapshot(self, cause, state, sensors):
        """Writes the true `state` and the `sensors` view after `cause`. Returns its seq."""
        record = {"cause": cause, "state": state.to_dict(), "sensors": sensors}
        if self.lines == 0:
            record["logVersion"] = LOG_VERSION
        return self.write(record, state.t_ms)
