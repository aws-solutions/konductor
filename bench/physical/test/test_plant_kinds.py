# SPDX-License-Identifier: Apache-2.0
"""kinds.py builds KINDS from a list of kind files (plant plugin design, step 2)."""
import json
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
    def test_the_built_ins_come_from_their_kind_files_in_order(self):
        # Each kind file is bench/plants/<kind>/kind.py, in plugin.json "order" (B-003 step 3b).
        self.assertEqual([os.path.relpath(f, kinds.PLANTS_DIR) for f in KIND_FILES],
                         [os.path.join(k, "kind.py") for k in ("conveyor-sim", "arm-sim", "arm-confined-space")])
        old = os.path.join(os.path.dirname(kinds.__file__), "kind_files")
        self.assertEqual([f for f in (os.listdir(old) if os.path.isdir(old) else []) if f.endswith(".py")], [])
        self.assertEqual(list(KINDS), ["conveyor-sim", "arm-sim", "arm-confined-space"])
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
        self.assertEqual(list(got), ["conveyor-sim", "arm-sim", "arm-confined-space", "toy-sim"])
        self.assertEqual(got["toy-sim"].name, "toy")
        self.assertEqual(got["conveyor-sim"].sim_version, CONVEYOR.sim_version)

    def test_two_files_with_one_env_kind_are_refused(self):
        with self.assertRaisesRegex(ValueError, "two kind files name 'toy-sim'"):
            load_kinds([self.write("a.py", TOY), self.write("b.py", TOY)])

    def plant(self, folder, order, text):
        os.makedirs(os.path.join(self.tmp.name, folder))
        self.write(os.path.join(folder, "plugin.json"), json.dumps({"name": folder, "order": order, "entry": "kind.py"}))
        return self.write(os.path.join(folder, "kind.py"), text)

    def test_a_plant_folder_loads_from_a_plants_root_in_its_order(self):
        import sim
        second = self.plant("toy-sim", 2, TOY)
        first = self.plant("lamp-sim", 1, TOY.replace("toy-sim", "lamp-sim"))
        os.makedirs(os.path.join(self.tmp.name, "not-a-plant"))
        folders = sim.plant_folders({}, self.tmp.name)
        self.assertEqual(folders, [os.path.join(self.tmp.name, d) for d in ("lamp-sim", "not-a-plant", "toy-sim")])
        self.assertEqual(kinds.plant_kind_files(folders), [first, second])
        self.assertEqual(list(kinds.load_plants(folders)), ["lamp-sim", "toy-sim"])

    def test_a_kind_file_must_name_its_plant_folder(self):
        self.plant("lamp-sim", 1, TOY)
        with self.assertRaisesRegex(ValueError, "ENV_KIND 'toy-sim' must equal its plant folder name 'lamp-sim'"):
            kinds.load_plants([os.path.join(self.tmp.name, "lamp-sim")])

    def test_a_file_without_env_kind_or_kind_is_refused(self):
        with self.assertRaisesRegex(ValueError, "must define ENV_KIND"):
            load_kinds([self.write("none.py", "X = 1\n")])
        with self.assertRaisesRegex(ValueError, "KIND must be a PlantKind"):
            load_kinds([self.write("bad.py", 'ENV_KIND = "x-sim"\nKIND = 3\n')])


class PlantSimFolders(unittest.TestCase):
    """Each plant's own simulator files live in bench/plants/<kind>/sim/ and still import as sim.* (B-003 step 3b)."""

    OWN = {
        "conveyor-sim": ["conveyor", "rules"],
        "arm-sim": ["arm", "arm_body", "arm_frames", "arm_kinematics", "arm_meta", "arm_motion", "arm_replay",
                    "arm_rules", "arm_scene", "arm_sensors", "arm_state"],
        "arm-confined-space": ["confined_gas", "confined_rules", "confined_space"],
    }

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_each_plant_module_is_found_in_its_plant_folder_and_only_shared_ones_stay(self):
        import importlib.util

        import sim
        for kind, names in self.OWN.items():
            for name in names:
                origin = importlib.util.find_spec(f"sim.{name}").origin
                self.assertEqual(origin, os.path.join(kinds.PLANTS_DIR, kind, "sim", f"{name}.py"))
        shared = os.path.dirname(sim.__file__)
        self.assertEqual(sorted(f for f in os.listdir(shared) if f.endswith(".py")), ["__init__.py", "faults.py", "meta.py"])

    def sim_dir(self, folder, *modules):
        """Makes <tmp>/plants/<folder>/sim holding empty `modules`; the folder "shared" goes beside plants instead."""
        root = self.tmp.name if folder == "shared" else os.path.join(self.tmp.name, "plants")
        d = os.path.join(root, folder, "sim")
        os.makedirs(d)
        for m in modules:
            open(os.path.join(d, f"{m}.py"), "w", encoding="utf-8").close()
        return d

    def test_plant_sim_folders_come_in_folder_name_order_and_a_plant_without_one_is_skipped(self):
        import sim
        second = self.sim_dir("toy-sim", "toy")
        first = self.sim_dir("lamp-sim", "lamp")
        os.makedirs(os.path.join(self.tmp.name, "plants", "no-sim"))
        plants = sim.plant_folders({}, os.path.join(self.tmp.name, "plants"))
        self.assertEqual(sim.plant_sim_dirs(plants, self.sim_dir("shared", "faults")), [first, second])

    def test_one_module_name_in_two_folders_is_refused(self):
        import sim
        shared = self.sim_dir("shared", "faults")
        self.sim_dir("lamp-sim", "lamp")
        self.sim_dir("toy-sim", "lamp")
        with self.assertRaisesRegex(ValueError, "sim module 'lamp' is in two folders"):
            sim.plant_sim_dirs(sim.plant_folders({}, os.path.join(self.tmp.name, "plants")), shared)
        os.remove(os.path.join(self.tmp.name, "plants", "toy-sim", "sim", "lamp.py"))
        self.sim_dir("bad-sim", "faults")
        with self.assertRaisesRegex(ValueError, "sim module 'faults' is in two folders"):
            sim.plant_sim_dirs(sim.plant_folders({}, os.path.join(self.tmp.name, "plants")), shared)


class PlantFoldersFromTheRunner(unittest.TestCase):
    """The runner names the plant folders in BENCH_PLANT_DIRS; with none named, the gateway reads bench/plants."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def folder(self, name, manifest=True):
        d = os.path.join(self.tmp.name, name)
        os.makedirs(d)
        if manifest:
            open(os.path.join(d, "plugin.json"), "w", encoding="utf-8").close()
        return d

    def test_the_named_folders_are_used_in_their_order(self):
        import sim
        b, a = self.folder("toy-sim"), self.folder("lamp-sim")
        self.assertEqual(sim.plant_folders({"BENCH_PLANT_DIRS": os.pathsep.join([b, a])}, "/nowhere"), [b, a])

    def test_with_none_named_every_folder_of_bench_plants_is_used(self):
        import sim
        self.assertEqual(sim.PLANT_FOLDERS, [os.path.join(sim.PLANTS_DIR, d) for d in sorted(os.listdir(sim.PLANTS_DIR))])
        self.assertEqual(sim.plant_folders({"BENCH_PLANT_DIRS": ""}, sim.PLANTS_DIR), sim.PLANT_FOLDERS)

    def test_a_named_folder_must_be_absolute_and_hold_a_plugin_json(self):
        import sim
        for bad, why in (("rel/toy-sim", "not an absolute path"), (self.folder("bare", manifest=False), "has no plugin.json"),
                         (os.path.join(self.tmp.name, "gone"), "has no plugin.json")):
            with self.assertRaisesRegex(ValueError, why):
                sim.plant_folders({"BENCH_PLANT_DIRS": bad}, "/nowhere")

    def test_the_gateway_loads_only_the_named_folders(self):
        import subprocess
        import sys

        conveyor = os.path.join(kinds.PLANTS_DIR, "conveyor-sim")
        code = "import _paths; from plant_gateway import kinds; print(list(kinds.KINDS))"
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "BENCH_PLANT_DIRS": conveyor}
        out = subprocess.run([sys.executable, "-c", code], cwd=os.path.dirname(__file__), env=env, capture_output=True, text=True)
        self.assertEqual(out.stdout.strip(), "['conveyor-sim']", out.stderr)


if __name__ == "__main__":
    unittest.main()
