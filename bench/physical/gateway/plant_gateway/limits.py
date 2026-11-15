# SPDX-License-Identifier: Apache-2.0
"""Input limits (8.6) and the gateway's own rlimits. Never decides a tool call."""
import resource
import signal
from dataclasses import dataclass

KIB = 1024
MIB = 1024 * KIB

ENDS_TRIAL = frozenset({"line", "calls", "bytes", "log_size", "nested_pidns"})


class LimitExceeded(Exception):
    """A limit was passed. `which` is its name; a name in ENDS_TRIAL makes the trial `plantLimit`."""

    def __init__(self, which):
        super().__init__(which)
        self.which = which

    @property
    def ends_trial(self):
        return self.which in ENDS_TRIAL


@dataclass(frozen=True)
class Limits:
    """Limit values. Tests pass smaller ones; the defaults are the proposed values in 8.6."""

    line_bytes: int = 64 * KIB
    control_frame_bytes: int = 16 * KIB
    json_depth: int = 16
    open_connections: int = 4
    connections_per_run: int = 32
    unsent_reply_bytes: int = 1 * MIB
    calls_per_run: int = 2000
    bytes_in_per_run: int = 8 * MIB
    idle_partial_line_s: float = 5.0
    peer_hold_s: float = 10.0
    log_file_bytes: int = 32 * MIB
    memory_bytes: int = 2048 * MIB
    open_files: int = 64


def json_depth(value):
    """Nesting depth of a parsed JSON value: 0 for a scalar, 1 for a flat object or array."""
    if isinstance(value, dict):
        return 1 + max((json_depth(v) for v in value.values()), default=0)
    if isinstance(value, list):
        return 1 + max((json_depth(v) for v in value), default=0)
    return 0


def apply_own_rlimits(limits):
    """Sets core dumps off and caps file size, memory and open files from `limits` for this process."""
    signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (limits.log_file_bytes, limits.log_file_bytes))
    resource.setrlimit(resource.RLIMIT_AS, (limits.memory_bytes, limits.memory_bytes))
    resource.setrlimit(resource.RLIMIT_NOFILE, (limits.open_files, limits.open_files))
