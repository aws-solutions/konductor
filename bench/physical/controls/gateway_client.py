# SPDX-License-Identifier: Apache-2.0
"""Drives one real gateway process from Python: fd 3 frames and gw.sock MCP lines. Never runs an agent."""
import hashlib
import json
import os
import secrets
import select
import socket
import subprocess
import sys
import time

PHYSICAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GATEWAY_START = os.path.join(PHYSICAL, "gateway", "start.py")
MCP_VERSION = "2025-11-25"


def sha256_file(path):
    """SHA-256 hex of the file at `path`."""
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


class JsonLines:
    """Newline-framed JSON over `sock`; a read waits at most `timeout` seconds."""

    def __init__(self, sock, timeout=5.0):
        self.sock = sock
        self.timeout = timeout
        self._buf = b""

    def send(self, obj):
        """Writes `obj` as one line."""
        self.sock.sendall((json.dumps(obj) + "\n").encode())

    def read(self):
        """The next line, parsed. Raises TimeoutError after `timeout`, EOFError when the peer closed."""
        deadline = time.monotonic() + self.timeout
        while b"\n" not in self._buf:
            left = deadline - time.monotonic()
            if left <= 0 or not select.select([self.sock], [], [], left)[0]:
                raise TimeoutError("no line")
            chunk = self.sock.recv(65536)
            if not chunk:
                raise EOFError("closed")
            self._buf += chunk
        line, self._buf = self._buf.split(b"\n", 1)
        return json.loads(line)

    def read_op(self, *ops):
        """The next frame whose `op` is one of `ops`, skipping heartbeats and anything else."""
        while True:
            frame = self.read()
            if frame.get("op") in ops:
                return frame


class GatewayProcess:
    """A gateway child process.

    `task` is the task JSON file and `files` every further file it loads (all are hash-listed in hello).
    `run_dir` holds gw.sock and both logs. `arm` is "policy" or "allow-all"; `test_mode` allows set_state.
    `python` runs the gateway; `hello_extra` overrides hello fields, and `hashes` overrides listed hashes.
    `plant_dirs` names the plant folders the gateway loads, as the runner does in BENCH_PLANT_DIRS; empty means
    every folder of bench/plants.
    """

    def __init__(self, task, run_dir, files=(), arm="policy", test_mode=False, python=sys.executable, hello_extra=None, hashes=None,
                 plant_dirs=()):
        self.token = secrets.token_hex(32)
        self.run_dir = run_dir
        self.socket_path = os.path.join(run_dir, "gw.sock")
        listed = {path: sha256_file(path) for path in (task, *files)}
        listed.update(hashes or {})
        ours, theirs = socket.socketpair()
        # The gateway runs with an otherwise empty environment; pass only the dynamic-linker search path when it is
        # set, so a Python built against a non-default shared library (e.g. the arm gateway's mujoco needing libffi
        # on this host) can still load its C extensions. No agent or task data is passed.
        gw_env = {k: os.environ[k] for k in ("LD_LIBRARY_PATH",) if k in os.environ}
        if plant_dirs:
            gw_env["BENCH_PLANT_DIRS"] = os.pathsep.join(plant_dirs)
        self.proc = subprocess.Popen([python, "-I", GATEWAY_START, "--control-fd", str(theirs.fileno())],
                                     pass_fds=[theirs.fileno()], env=gw_env)
        theirs.close()
        self.control = JsonLines(ours)
        self.clients = []
        self.hello = {
            "op": "hello", "v": "plant-control/1", "token": self.token, "runId": secrets.token_hex(16), "release": "local",
            "files": listed, "task": task, "arm": arm, "seed": 3, "socket": self.socket_path, "logDir": run_dir,
            "testMode": test_mode, **(hello_extra or {}),
        }
        self.control.send(self.hello)

    def ready(self):
        """Waits for `ready` (or the `error` that replaces it) and returns that frame."""
        return self.control.read_op("ready", "error")

    def peer(self, pidns=None):
        """Sends `peer` with `pidns`, by default this process's own pid namespace."""
        self.control.send({"op": "peer", "token": self.token, "pidns": pidns or os.readlink("/proc/self/ns/pid")})

    def set_state(self, state, sensors, now_ms, approval, token=None, op="set_state"):
        """Sends a test-mode state frame (`set_state`, or `set_arm_state` for the arm); `token` replaces the real token to test a refusal."""
        self.control.send({"op": op, "token": token or self.token, "state": state, "sensors": sensors,
                           "now_ms": now_ms, "approval": approval})

    def connect(self):
        """A raw gw.sock connection."""
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(self.socket_path)
        self.clients.append(sock)
        return JsonLines(sock)

    def mcp_client(self):
        """A gw.sock connection that has sent `initialize`."""
        client = self.connect()
        client.send({"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {"protocolVersion": MCP_VERSION}})
        client.read()
        return client

    def stop(self):
        """Sends `stop` and returns `final`."""
        self.control.send({"op": "stop", "token": self.token})
        return self.control.read_op("final")

    def close(self):
        """Kills the process if it still runs and closes every socket."""
        if self.proc.poll() is None:
            self.proc.kill()
        self.proc.wait()
        for sock in self.clients + [self.control.sock]:
            sock.close()
