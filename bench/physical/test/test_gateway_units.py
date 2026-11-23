# SPDX-License-Identifier: Apache-2.0
import dataclasses
import hashlib
import json
import os
import tempfile
import unittest

from gateway_fixtures import fixture, read_jsonl
from plant_gateway.__main__ import load_rule
from plant_gateway.kinds import KINDS
from plant_gateway.policy import FixedRule, PolicyInvalid
from plant_gateway.control import ControlError, ControlReader, load_frame_schemas
from plant_gateway.limits import json_depth
from plant_gateway.log import GatewayLog, WorldLog
from plant_gateway.schema import SchemaError, check
from plant_gateway.tools import BadArguments, args_sha256, canonical_args, check_args
from sim.conveyor import state_from_start

TOKEN = "a" * 64


def hello(**over):
    frame = {"op": "hello", "v": "plant-control/1", "token": TOKEN, "runId": "0" * 32, "release": "r", "files": {},
             "task": "t.json", "arm": "policy", "seed": 1, "socket": "/s", "logDir": "/l", "testMode": False}
    return {**frame, **over}


def set_state_frame():
    state = {"running": False, "speed_mmps": 0, "target_mmps": 0, "rated_max_mmps": 1000, "guard": "closed",
             "estop": False, "jammed": False, "jam_since_ms": None, "person_in_zone": False}
    sensors = {"speed": {"value": 0, "t_ms": 0}, "jam": {"value": False, "t_ms": 0},
               "zone": {"person": False, "t_ms": 0}, "guard": {"value": "closed", "t_ms": 0}}
    return {"op": "set_state", "token": TOKEN, "state": state, "sensors": sensors, "now_ms": 0, "approval": "none"}


def line(frame):
    return json.dumps(frame).encode()


class LoadRuleTest(unittest.TestCase):
    """With no plant.cedar in hello.files, the kind's own `fixed_rule` decides; the gateway never checks a kind's name."""

    def test_the_conveyor_runs_its_fixed_rule_with_no_cedar_policy(self):
        rule, _ = load_rule(hello(), KINDS["conveyor-sim"])
        self.assertIsInstance(rule, FixedRule)

    def test_the_arm_needs_a_cedar_policy(self):
        with self.assertRaisesRegex(PolicyInvalid, "the arm plant needs plant.cedar"):
            load_rule(hello(), KINDS["arm-sim"])

    def test_any_kind_with_a_fixed_rule_runs_it(self):
        kind = dataclasses.replace(KINDS["arm-sim"], name="other", fixed_rule=FixedRule)
        rule, _ = load_rule(hello(), kind)
        self.assertIsInstance(rule, FixedRule)


class SchemaTest(unittest.TestCase):
    def test_a_bool_is_not_an_integer(self):
        with self.assertRaises(SchemaError):
            check(True, {"type": "integer"})

    def test_an_unknown_field_fails_a_closed_object(self):
        with self.assertRaises(SchemaError):
            check({"x": 1}, {"type": "object", "properties": {}, "additionalProperties": False})


class ToolArgumentsTest(unittest.TestCase):
    def test_a_float_speed_is_bad_arguments(self):
        with self.assertRaises(BadArguments):
            check_args("set_speed", {"speed_mmps": 700.0})

    def test_an_unknown_field_is_bad_arguments(self):
        with self.assertRaises(BadArguments):
            check_args("stop", {"force": True})

    def test_approval_takes_only_open_guard(self):
        with self.assertRaises(BadArguments):
            check_args("request_approval", {"action": "start", "reason": "x"})

    def test_canonical_args_match_the_shared_vectors(self):
        for vector in fixture("canonical-args.json")["vectors"]:
            self.assertEqual(canonical_args(vector["args"]), vector["canonical"])

    def test_the_args_hash_ignores_key_order(self):
        self.assertEqual(args_sha256({"a": 1, "b": 2}), args_sha256({"b": 2, "a": 1}))


class LimitsTest(unittest.TestCase):
    def test_json_depth_counts_nested_containers(self):
        self.assertEqual((json_depth(1), json_depth({}), json_depth({"a": [{"b": 1}]})), (0, 1, 3))


class RunLogTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "gateway.jsonl")
        self.log = GatewayLog(self.path, "0" * 32, lambda: "t")

    def tearDown(self):
        self.log.close()
        self.dir.cleanup()

    def test_seq_starts_at_zero_with_no_gaps(self):
        for _ in range(3):
            self.log.event("mcp", 0, method="ping")
        self.assertEqual([e["seq"] for e in read_jsonl(self.path)], [0, 1, 2])

    def test_the_running_hash_equals_the_file_hash(self):
        self.log.event("mcp", 0, method="ping")
        self.log.event("mcp", 5, method="ping")
        with open(self.path, "rb") as f:
            self.assertEqual(self.log.sha256, hashlib.sha256(f.read()).hexdigest())

    def test_an_existing_file_is_never_reused(self):
        with self.assertRaises(FileExistsError):
            GatewayLog(self.path, "0" * 32, lambda: "t")

    def test_the_log_descriptor_is_not_inherited(self):
        self.assertFalse(os.get_inheritable(self.log._fd))

    def test_the_first_world_line_carries_the_log_version(self):
        world = WorldLog(os.path.join(self.dir.name, "world.jsonl"), "0" * 32, lambda: "t")
        state = state_from_start({"rated_max_mmps": 1000})
        world.snapshot("tick", state, {})
        world.snapshot("tick", state, {})
        world.close()
        lines = read_jsonl(os.path.join(self.dir.name, "world.jsonl"))
        self.assertEqual([("logVersion" in x) for x in lines], [True, False])


class ControlReaderTest(unittest.TestCase):
    def setUp(self):
        self.reader = ControlReader(load_frame_schemas(), 16 * 1024)

    def code_of(self, raw):
        with self.assertRaises(ControlError) as caught:
            self.reader.read(raw)
        return caught.exception.code

    def test_hello_is_accepted_first(self):
        self.assertEqual(self.reader.read(line(hello()))["op"], "hello")

    def test_peer_before_hello_is_out_of_order(self):
        self.assertEqual(self.code_of(line({"op": "stop", "token": TOKEN})), "out_of_order")

    def test_a_second_hello_is_out_of_order(self):
        self.reader.read(line(hello()))
        self.assertEqual(self.code_of(line(hello())), "out_of_order")

    def test_a_wrong_token_is_bad_token(self):
        self.reader.read(line(hello()))
        self.assertEqual(self.code_of(line({"op": "stop", "token": "b" * 64})), "bad_token")

    def test_an_unknown_field_is_bad_frame(self):
        self.assertEqual(self.code_of(line(hello(extra=1))), "bad_frame")

    def test_an_unknown_op_is_bad_frame(self):
        self.assertEqual(self.code_of(line({"op": "reset", "token": TOKEN})), "bad_frame")

    def test_a_frame_over_the_size_limit_is_bad_frame(self):
        self.assertEqual(self.code_of(b" " * (16 * 1024 + 1)), "bad_frame")

    def test_set_state_outside_test_mode_is_refused(self):
        self.reader.read(line(hello()))
        self.assertEqual(self.code_of(line(set_state_frame())), "not_test_mode")

    def test_set_state_in_test_mode_is_accepted(self):
        self.reader.read(line(hello(testMode=True)))
        self.assertEqual(self.reader.read(line(set_state_frame()))["op"], "set_state")

    def test_set_state_with_an_unknown_state_field_is_bad_frame(self):
        self.reader.read(line(hello(testMode=True)))
        frame = set_state_frame()
        frame["state"]["speed"] = 1
        self.assertEqual(self.code_of(line(frame)), "bad_frame")


if __name__ == "__main__":
    unittest.main()
