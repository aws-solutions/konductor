# SPDX-License-Identifier: Apache-2.0
"""kinds.py builds KINDS from a list of kind files (plant plugin design, step 2)."""
import os
import tempfile
import unittest

import _paths  # noqa: F401
from plant_gateway import kinds
from plant_gateway.kinds import ARM, CONVEYOR, KIND_FILES, KINDS, PlantKind, load_kinds

TOY = '''
from plant_gateway.plant_kind import PlantKind
from plant_gateway.tools import CONVEYOR_TOOLS

ENV_KIND = "toy-sim"
KIND = PlantKind(name="toy", sim_version="toy/1", tools=CONVEYOR_TOOLS, approvable=frozenset(), rules=None,
                 state_type=dict, test_op="set_toy", build=None, context=None, check_limits=lambda limits: None)
'''


class KindFiles(unittest.TestCase):
    def test_the_two_built_ins_come_from_two_files_in_the_old_order(self):
        self.assertEqual([os.path.basename(f) for f in KIND_FILES], ["conveyor.py", "arm.py"])
        self.assertEqual(list(KINDS), ["conveyor-sim", "arm-sim"])
        self.assertIs(KINDS["conveyor-sim"], CONVEYOR)
        self.assertIs(KINDS["arm-sim"], ARM)
        self.assertIs(kinds.PlantKind, PlantKind)

    def test_the_built_ins_keep_their_values(self):
        from sim import arm_rules, rules
        from sim.arm_meta import SIM_VERSION as ARM_SIM_VERSION
        from sim.arm_state import ArmState
        from sim.conveyor import SIM_VERSION as CONVEYOR_SIM_VERSION
        from sim.conveyor import TrueState

        from plant_gateway.approval import APPROVABLE
        from plant_gateway.arm_context import arm_decision_context, validate_limits
        from plant_gateway.arm_tools import ARM_TOOLS
        from plant_gateway.policy import FixedRule
        from plant_gateway.tools import CONVEYOR_TOOLS

        self.assertEqual((CONVEYOR.name, CONVEYOR.sim_version, CONVEYOR.test_op), ("conveyor", CONVEYOR_SIM_VERSION, "set_state"))
        self.assertIs(CONVEYOR.tools, CONVEYOR_TOOLS)
        self.assertIs(CONVEYOR.approvable, APPROVABLE)
        self.assertIs(CONVEYOR.rules, rules)
        self.assertIs(CONVEYOR.state_type, TrueState)
        self.assertIs(CONVEYOR.fixed_rule, FixedRule)
        self.assertIsNone(CONVEYOR.check_limits({}))
        self.assertEqual((ARM.name, ARM.sim_version, ARM.test_op), ("arm", ARM_SIM_VERSION, "set_arm_state"))
        self.assertIs(ARM.tools, ARM_TOOLS)
        self.assertEqual(ARM.approvable, frozenset({"open_door"}))
        self.assertIs(ARM.rules, arm_rules)
        self.assertIs(ARM.state_type, ArmState)
        self.assertIs(ARM.context, arm_decision_context)
        self.assertIs(ARM.check_limits, validate_limits)
        self.assertIsNone(ARM.fixed_rule)

    def test_loading_the_kinds_does_not_import_the_arm_simulator(self):
        import subprocess
        import sys

        code = "import _paths, sys; import plant_gateway.kinds; print('sim.arm' in sys.modules, 'mujoco' in sys.modules)"
        out = subprocess.run([sys.executable, "-c", code], cwd=os.path.dirname(__file__), capture_output=True, text=True, check=True)
        self.assertEqual(out.stdout.strip(), "False False")


class LoadKinds(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def write(self, name, text):
        path = os.path.join(self.tmp.name, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return path

    def test_a_new_kind_file_loads_by_path_with_no_core_edit(self):
        got = load_kinds(list(KIND_FILES) + [self.write("toy.py", TOY)])
        self.assertEqual(list(got), ["conveyor-sim", "arm-sim", "toy-sim"])
        self.assertEqual(got["toy-sim"].name, "toy")
        self.assertEqual(got["conveyor-sim"].sim_version, CONVEYOR.sim_version)

    def test_two_files_with_one_env_kind_are_refused(self):
        with self.assertRaisesRegex(ValueError, "two kind files name 'toy-sim'"):
            load_kinds([self.write("a.py", TOY), self.write("b.py", TOY)])

    def test_a_file_without_env_kind_or_kind_is_refused(self):
        with self.assertRaisesRegex(ValueError, "must define ENV_KIND"):
            load_kinds([self.write("none.py", "X = 1\n")])
        with self.assertRaisesRegex(ValueError, "KIND must be a PlantKind"):
            load_kinds([self.write("bad.py", 'ENV_KIND = "x-sim"\nKIND = 3\n')])


if __name__ == "__main__":
    unittest.main()
