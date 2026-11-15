# SPDX-License-Identifier: Apache-2.0
import hashlib
import json
import os
import select
import socket
import subprocess
import sys
import tempfile
import time
import unittest

from gateway_fixtures import MOVING, read_jsonl
import _paths

START = os.path.join(_paths.PHYSICAL, "gateway", "start.py")
TOKEN = "c" * 64
INIT = {"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {"protocolVersion": "2025-11-25"}}


def own_pidns():
    return os.readlink("/proc/self/ns/pid")


class LineSocket:
    """Newline-framed JSON over `sock`, with a read deadline of `timeout` seconds."""

    def __init__(self, sock, timeout=5.0):
        self.sock = sock
        self.timeout = timeout
        self.buf = b""

    def send(self, obj):
        self.sock.sendall((json.dumps(obj) + "\n").encode())

    def read(self):
        deadline = time.monotonic() + self.timeout
        while b"\n" not in self.buf:
            left = deadline - time.monotonic()
            if left <= 0 or not select.select([self.sock], [], [], left)[0]:
                raise TimeoutError("no line")
            chunk = self.sock.recv(65536)
            if not chunk:
                raise EOFError("closed")
            self.buf += chunk
        line, self.buf = self.buf.split(b"\n", 1)
        return json.loads(line)

    def read_op(self, op):
        while True:
            frame = self.read()
            if frame.get("op") == op:
                return frame


class GatewayRun:
    """A real gateway process on temp paths. `task_hash` overrides the task file hash sent in hello."""

    def __init__(self, arm="policy", task_hash=None, hello_extra=None):
        self.dir = tempfile.TemporaryDirectory(prefix="gw")
        self.socket_path = os.path.join(self.dir.name, "gw.sock")
        task = os.path.join(self.dir.name, "task.json")
        data = json.dumps({"environment": {"start": MOVING}}).encode()
        with open(task, "wb") as f:
            f.write(data)
        ours, theirs = socket.socketpair()
        self.proc = subprocess.Popen([sys.executable, "-I", START, "--control-fd", str(theirs.fileno())],
                                     pass_fds=[theirs.fileno()], env={})
        theirs.close()
        self.control = LineSocket(ours)
        self.hello = {
            "op": "hello", "v": "plant-control/1", "token": TOKEN, "runId": "1" * 32, "release": "test-only",
            "files": {task: task_hash or hashlib.sha256(data).hexdigest()}, "task": task, "arm": arm, "seed": 3,
            "socket": self.socket_path, "logDir": self.dir.name, "testMode": False, **(hello_extra or {}),
        }
        self.clients = []
        self.control.send(self.hello)

    def connect(self):
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(self.socket_path)
        self.clients.append(sock)
        return LineSocket(sock)

    def peer(self, pidns=None):
        self.control.send({"op": "peer", "token": TOKEN, "pidns": pidns or own_pidns()})

    def mcp_client(self):
        client = self.connect()
        client.send(INIT)
        client.read()
        return client

    def stop(self):
        self.control.send({"op": "stop", "token": TOKEN})
        return self.control.read_op("final")

    def log(self, name):
        return read_jsonl(os.path.join(self.dir.name, name))

    def close(self):
        if self.proc.poll() is None:
            self.proc.kill()
        self.proc.wait()
        for sock in self.clients + [self.control.sock]:
            sock.close()
        self.dir.cleanup()


class StartupTest(unittest.TestCase):
    def test_ready_names_the_policy_hash_and_simulator_version(self):
        run = GatewayRun()
        ready = run.control.read_op("ready")
        self.assertEqual((ready["v"], ready["seq"], ready["simVersion"]), ("plant-control/1", 0, "1"))
        self.assertEqual(len(ready["policySha256"]), 64)
        run.close()

    def test_a_task_file_whose_hash_differs_is_policy_invalid(self):
        run = GatewayRun(task_hash="0" * 64)
        self.assertEqual(run.control.read_op("error")["code"], "policy_invalid")
        self.assertEqual(run.proc.wait(5), 3)
        run.close()

    def test_a_hello_with_an_unknown_field_is_refused(self):
        run = GatewayRun(hello_extra={"debug": True})
        self.assertEqual(run.control.read_op("error")["code"], "bad_frame")
        self.assertEqual(run.proc.wait(5), 2)
        run.close()

    def test_core_dumps_are_off(self):
        run = GatewayRun()
        run.control.read_op("ready")
        with open(f"/proc/{run.proc.pid}/limits") as f:
            core = next(line for line in f if line.startswith("Max core file size"))
        self.assertEqual(core.split()[4:6], ["0", "0"])
        run.close()


class RunTest(unittest.TestCase):
    def setUp(self):
        self.run = GatewayRun()
        self.run.control.read_op("ready")

    def tearDown(self):
        self.run.close()

    def test_a_heartbeat_carries_the_running_log_hashes(self):
        hb = self.run.control.read_op("hb")
        self.assertEqual(set(hb["logSha256"]), {"gateway", "world"})
        self.assertIsNone(hb["limitHit"])

    def test_a_connection_made_before_peer_is_held_then_answered(self):
        client = self.run.connect()
        client.send(INIT)
        with self.assertRaises(TimeoutError):
            LineSocket(client.sock, timeout=0.5).read()
        self.run.peer()
        self.assertEqual(client.read()["result"]["protocolVersion"], "2025-11-25")

    def test_a_peer_from_another_pid_namespace_is_closed_as_foreign(self):
        client = self.run.connect()
        self.run.peer("pid:[1]")
        with self.assertRaises(EOFError):
            client.read()
        self.run.stop()
        self.assertIn("foreign_conn", [e["type"] for e in self.run.log("gateway.jsonl")])

    def test_tools_list_offers_the_seven_plant_tools(self):
        self.run.peer()
        client = self.run.mcp_client()
        client.send({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        names = [t["name"] for t in client.read()["result"]["tools"]]
        self.assertEqual(sorted(names), sorted(["get_state", "set_speed", "start", "stop", "estop", "open_guard", "request_approval"]))

    def test_an_over_long_line_closes_the_connection_and_ends_the_trial(self):
        self.run.peer()
        client = self.run.mcp_client()
        client.sock.sendall(b"x" * (65 * 1024) + b"\n")
        with self.assertRaises((EOFError, ConnectionResetError)):
            client.read()
        hb = self.run.control.read_op("hb")
        while hb["limitHit"] is None:
            hb = self.run.control.read_op("hb")
        self.assertEqual(hb["limitHit"], "line")

    def test_a_stop_with_a_wrong_token_is_refused_and_the_run_goes_on(self):
        self.run.control.send({"op": "stop", "token": "d" * 64})
        self.assertEqual(self.run.control.read_op("error")["code"], "bad_token")
        self.assertIsNone(self.run.proc.poll())

    def test_stop_settles_and_final_matches_both_files(self):
        self.run.peer()
        client = self.run.mcp_client()
        client.send({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_state", "arguments": {}}})
        client.read()
        final = self.run.stop()
        self.assertEqual(self.run.proc.wait(5), 0)
        for name in ("gateway", "world"):
            with open(os.path.join(self.run.dir.name, f"{name}.jsonl"), "rb") as f:
                data = f.read()
            self.assertEqual(final["logSha256"][name], hashlib.sha256(data).hexdigest())
            self.assertEqual(final["lines"][name], data.count(b"\n"))
        types = [e["type"] for e in self.run.log("gateway.jsonl")]
        self.assertEqual(types[-2:], ["settle", "stop"])
        self.assertFalse(os.path.exists(self.run.socket_path))


if __name__ == "__main__":
    unittest.main()
