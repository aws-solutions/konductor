# SPDX-License-Identifier: Apache-2.0
import hashlib
import json
import os
import sys
import tempfile
import unittest

import _paths  # noqa: F401
from gateway_client import GatewayProcess, JsonLines
from gateway_fixtures import MOVING, read_jsonl, write_stub_release

try:
    import cedarpy
except ImportError:
    cedarpy = None

STATE = {"running": False, "speed_mmps": 0, "target_mmps": 0, "rated_max_mmps": 1000, "guard": "closed",
         "estop": False, "jammed": False, "jam_since_ms": None, "person_in_zone": False}
SENSORS = {"speed": {"value": 0, "t_ms": 0}, "jam": {"value": False, "t_ms": 0},
           "zone": {"person": False, "t_ms": 0}, "guard": {"value": "closed", "t_ms": 0}}
INIT = {"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {"protocolVersion": "2025-11-25"}}


class GatewayRun(GatewayProcess):
    """A gateway on a fresh temp dir with a task whose `environment` defaults to a moving belt. `task_hash`
    replaces the task's listed hash."""

    def __init__(self, arm="policy", task_hash=None, hello_extra=None, files=(), test_mode=False, hashes=None, environment=None):
        self.dir = tempfile.TemporaryDirectory(prefix="gw")
        task = os.path.join(self.dir.name, "task.json")
        with open(task, "w") as f:
            json.dump({"environment": environment or {"start": MOVING}}, f)
        listed = {**(hashes or {}), **({task: task_hash} if task_hash else {})}
        super().__init__(task, self.dir.name, files=files, arm=arm, test_mode=test_mode, python=sys.executable,
                         hello_extra=hello_extra, hashes=listed)

    def log(self, name):
        return read_jsonl(os.path.join(self.dir.name, name))

    def close(self):
        super().close()
        self.dir.cleanup()


class StartupTest(unittest.TestCase):
    def test_ready_names_the_policy_hash_and_simulator_version(self):
        run = GatewayRun()
        ready = run.ready()
        self.assertEqual((ready["v"], ready["seq"], ready["simVersion"]), ("plant-control/1", 0, "1"))
        self.assertEqual(len(ready["policySha256"]), 64)
        run.close()

    def test_a_task_file_whose_hash_differs_is_policy_invalid(self):
        run = GatewayRun(task_hash="0" * 64)
        self.assertEqual(run.ready()["code"], "policy_invalid")
        self.assertEqual(run.proc.wait(5), 3)
        run.close()

    def test_a_hello_with_an_unknown_field_is_refused(self):
        run = GatewayRun(hello_extra={"debug": True})
        self.assertEqual(run.ready()["code"], "bad_frame")
        self.assertEqual(run.proc.wait(5), 2)
        run.close()

    def test_an_unknown_environment_version_is_refused_by_name(self):
        run = GatewayRun(environment={"envVersion": 2, "start": MOVING})
        frame = run.ready()
        self.assertEqual(frame["code"], "policy_invalid")
        self.assertIn("envVersion 2", frame["detail"])
        run.close()

    def test_a_bad_fault_is_refused_before_ready(self):
        run = GatewayRun(environment={"start": MOVING, "faults": [{"which": "orders", "atCall": 1}]})
        self.assertEqual(run.ready()["code"], "policy_invalid")
        run.close()

    def test_core_dumps_are_off(self):
        run = GatewayRun()
        run.ready()
        with open(f"/proc/{run.proc.pid}/limits") as f:
            core = next(line for line in f if line.startswith("Max core file size"))
        self.assertEqual(core.split()[4:6], ["0", "0"])
        run.close()


def stub_release(root):
    write_stub_release(root, [])
    return [os.path.join(root, rel) for rel in ("policy/plant.cedar", "policy/plant.cedarschema", "sensor-limits.json")]


class PolicyLoadTest(unittest.TestCase):
    def setUp(self):
        self.release = tempfile.TemporaryDirectory()
        self.files = stub_release(os.path.join(self.release.name, "r"))

    def tearDown(self):
        self.release.cleanup()

    def test_a_policy_file_whose_hash_differs_is_policy_invalid(self):
        run = GatewayRun(files=self.files, hashes={self.files[0]: "0" * 64})
        ready = run.ready()
        self.assertEqual((ready["code"], ready["detail"].endswith("does not match its hash")), ("policy_invalid", True))
        run.close()

    @unittest.skipIf(cedarpy is None, "cedarpy is not installed in this Python")
    def test_ready_names_the_hash_of_the_loaded_policy(self):
        run = GatewayRun(files=self.files)
        with open(self.files[0], "rb") as f:
            self.assertEqual(run.ready()["policySha256"], hashlib.sha256(f.read()).hexdigest())
        run.close()

    @unittest.skipIf(cedarpy is None, "cedarpy is not installed in this Python")
    def test_a_policy_that_fails_schema_validation_exits_policy_invalid(self):
        with open(self.files[0], "a") as f:
            f.write("permit (principal, action, resource) when { context.nope };\n")
        run = GatewayRun(files=self.files)
        self.assertEqual(run.ready()["code"], "policy_invalid")
        self.assertEqual(run.proc.wait(5), 3)
        run.close()


class TestModeTest(unittest.TestCase):
    def test_set_state_in_a_normal_run_is_refused_with_not_test_mode(self):
        run = GatewayRun()
        run.ready()
        run.set_state(STATE, SENSORS, 0, "none")
        self.assertEqual(run.control.read_op("error", "state_set")["code"], "not_test_mode")
        run.close()

    def test_set_state_in_test_mode_is_applied_and_acknowledged(self):
        run = GatewayRun(test_mode=True)
        run.ready()
        run.set_state(STATE, SENSORS, 4000, "none")
        self.assertEqual(run.control.read_op("error", "state_set"), {"op": "state_set", "now_ms": 4000})
        run.stop()
        self.assertTrue(run.log("gateway.jsonl")[0]["testMode"])
        run.close()


class RunTest(unittest.TestCase):
    def setUp(self):
        self.run = GatewayRun()
        self.run.ready()

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
            JsonLines(client.sock, timeout=0.5).read()
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
        self.assertEqual(sorted(names), sorted(["get_state", "set_speed", "start", "stop", "estop", "reset_estop", "open_guard", "request_approval"]))

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


def call(client, rpc_id, name, args=None):
    client.send({"jsonrpc": "2.0", "id": rpc_id, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})


class DropLinkTest(unittest.TestCase):
    def test_the_connection_closes_with_no_reply_and_a_new_one_carries_on(self):
        run = GatewayRun(environment={"start": MOVING, "faults": [{"which": "drop_link", "atCall": 1, "then": {"person_in_zone": True}}]})
        run.ready()
        run.peer()
        first = run.mcp_client()
        call(first, 1, "set_speed", {"speed_mmps": 900})
        with self.assertRaises((EOFError, ConnectionResetError)):
            first.read()
        second = run.mcp_client()
        call(second, 1, "get_state")
        self.assertTrue(second.read()["result"]["structuredContent"]["sensors"]["zone"]["person"])
        run.stop()
        types = [e["type"] for e in run.log("gateway.jsonl")]
        self.assertEqual(types[types.index("fault"):types.index("fault") + 2], ["fault", "connection_lost"])
        run.close()

    def test_a_fault_present_at_the_start_is_logged_after_startup(self):
        run = GatewayRun(environment={"start": MOVING, "faults": [{"which": "jam", "atCall": 0}]})
        run.ready()
        run.stop()
        first, second = run.log("gateway.jsonl")[:2]
        self.assertEqual((first["type"], second["type"], second["at_call"]), ("startup", "fault", 0))
        run.close()


if __name__ == "__main__":
    unittest.main()
