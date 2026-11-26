# Design: plants as plugins

Date: 2026-11-24. Status: steps 1 and 2 built, step 3a built (2026-11-25), step 3b metadata, kind files, folder hashes, the simulator split, the registry read and the plant folders from the runner built (2026-11-26; see BACKLOG B-003). Row: BACKLOG B-003 (DEBT D-111 and D-207 are closed).

## The problem

The bench has two plants: the conveyor and the robot arm. A third plant (a mixer, a crane, a warehouse robot) means
edits in five core files, in two languages:

| file | what it holds per plant |
| --- | --- |
| `bench/physical/gateway/plant_gateway/kinds.py` | `KINDS`: the `PlantKind` (simulator, tools, rules, Cedar context, limits check) |
| `bench/runner/lib/plant/meta.js` | `KIND_META`: the plant's metadata file (`schemas/plant-meta-*.json` then, `plants/<kind>/meta.json` since step 3b: tools, rules, fields) |
| `bench/runner/lib/plant/agent-file.js` | `PROMPTS`: the one-line operator prompt |
| `bench/runner/lib/python-pin.js` | `GATEWAY_MODULES`: the Python modules the gateway needs (`mujoco`, `numpy`) |
| `bench/report/plant-controls.js` | `CONTROLS`: what each control suite must show (the arm reuses the conveyor's, by name) |

The good news: both sides already read one record per plant. Python has the `PlantKind` dataclass, and Node has one
metadata file per kind. So the change is about where the records come from, not what they hold.

## The fix in one line

A plant becomes one folder with one manifest. The five tables are built from the folders at start, and the two
built-in plants move into folders of their own, so no code names `conveyor-sim` or `arm-sim`.

## What a plant folder holds

```text
bench/plants/<name>/
  plugin.json       { "benchApi": 1, "kind": "plant", "name": "arm-sim", "version", "meta", "entry", "prompt",
                      "gatewayModules": ["cedarpy", "mujoco", "numpy"], "controls": "controls.js" }
  meta.json         today's plant-meta-*.json, unchanged
  kind.py           defines KIND = PlantKind(...), today's ARM block in kinds.py
  sim/ ...          the simulator and rules modules (today under bench/physical/sim)
  controls.js       what each control must show (optional: a plant without it reuses the shared table)
  test/             the plant's own tests
```

| manifest field | which core table it fills |
| --- | --- |
| `name` | the `environment.kind` a task writes |
| `meta` | `KIND_META` in `meta.js` |
| `entry` (`kind.py`) | `KINDS` in `kinds.py`: the gateway imports `KIND` from the file with `importlib`, by path |
| `prompt` | `PROMPTS` in `agent-file.js` |
| `gatewayModules` | `GATEWAY_MODULES` in `python-pin.js` |
| `controls` | `CONTROLS` in `plant-controls.js` |

The Node side reads the manifests through `core/registry.js` as parts of a new kind, `plant`. The Python side gets the
plant's folder from the runner, as a new gateway argument, so the gateway never scans folders.

What stays core and is never part of a plant: the gateway loop, the Cedar double ask, the approval records, the log
format and its version lines, the shim, the walls, the spend guard and the release signature check. A plant brings a
simulator and its rules; it cannot change how a call is decided or logged.

## The signed-release rule

A counted plant run reads a signed release (`plant-r2`, `plant-arm-r1`). A release signs the tasks, the policy, the
limits and the agent binary; it does not hold the simulator code. The code is pinned another way: the gateway refuses
an `envVersion` it does not know, writes its simulator's `sim_version` in the startup line, and the run config records
the bench commit. A move into a plant folder must keep all three the same, so a signed release made before the move
still runs and scores the same after it. The registry also records each plant folder's hash in `run-config.json`, as it
does for harness plugins, so a result names the exact plant code that made it.

## How we know it works

1. A test plant (`bench/physical/test/plants/toy-lamp`: one lamp, two tools, one rule) loads from a scratch plant root
   with no core edit, runs a scripted trial through the real gateway, and is scored by `plant-report`.
2. The conveyor and arm, moved into folders, give byte-equal gateway logs and the same `plant-report` on the shipped
   fixtures (`bench/physical/fixtures`), and the policy test passes on `plant-r2` and the arm stub release.
3. `git grep -n "'arm-sim'\|'conveyor-sim'" bench/runner bench/report` finds only the plant folders and tests.

## Order of work

1. Node side: read `KIND_META`, `PROMPTS`, `GATEWAY_MODULES` and `CONTROLS` from one per-kind record, built from the
   two existing kinds in one module. No folder moves yet, no output change.
2. Python side: `kinds.py` builds `KINDS` from a list of kind files; the two existing blocks move into two files.
3. Move each built-in into `bench/plants/<name>/` with its manifest, keeping `envVersion` and `sim_version`.
   3a (built 2026-11-25): each kind's Node record is a `bench/plants/<kind>/plant.json` (later `plugin.json`, see "registry read"; `benchApi`, `kind: "plant"`,
   `name`, `order`, `meta`, `prompt`, `gatewayModules`, `sharedControls`), read and checked by
   `runner/lib/plant/kinds.js`, which no longer names a kind. `sharedControls` stands in for `controls.js`.
   3b, first part (built 2026-11-26): each kind's metadata moved, byte for byte, from `physical/schemas/plant-meta-*.json`
   to `bench/plants/<kind>/meta.json`; the manifest names it as `meta.json`, and `sim/meta.py`,
   `sim/confined_space.py` and `controls/arm-control.js` read it there. `control-v1.json` is not per plant and stays.
   3b, second part (built 2026-11-26): each kind file moved, byte for byte, from `plant_gateway/kind_files/` to
   `bench/plants/<kind>/kind.py`; the manifest names it in `python` (later `entry`). The gateway's `kinds.py` reads the plant folders
   (their `python` and `order` fields) and refuses a kind file whose `ENV_KIND` is not its folder name. The gateway
   then still found `bench/plants` by its own path (see "plant folders from the runner" below).
   3b, folder hashes (built 2026-11-26): a plant suite's `run-config.json` records `plant.folders`, each plant folder
   with its sha256 (`plantRecord()` in `runner/lib/plant/kinds.js`, `folderHash` from `core/registry.js`). The
   shared simulator in `physical/sim` is not in a folder, so the bench commit still pins it.
   3b, simulator split (built 2026-11-26): each plant's own simulator modules moved, byte for byte, to
   `bench/plants/<kind>/sim/` (conveyor: `conveyor.py`, `rules.py`; arm: `arm.py`, `arm_*.py`; confined space:
   `confined_*.py`). Only `faults.py` and `meta.py`, which every plant uses, stay in `physical/sim`. A plant folder
   name has a hyphen, so it cannot be a Python package; instead `physical/sim/__init__.py` adds each plant's `sim`
   folder to the `sim` package path, so `sim.conveyor` and the modules' relative imports work unchanged, and it
   refuses one module name in two folders. The confined space plant still imports the arm's modules (`sim.arm`,
   `sim.arm_state`), so its folder hash does not cover them; the arm folder's hash does.
   3b, registry read (built 2026-11-26): the manifest is `plugin.json`, the name every plugin uses (it was `plant.json`,
   and `python` is now `entry`; `version` is new). `core/registry.js` `readPlugin(dir, ['plant'])` checks it, as it does
   for a harness: `benchApi`, `kind`, a name equal to the folder, `version`, and `meta` and `entry` as files inside the
   folder. A plant's meta has no `id`, so only the folder name ties them. The registry's own plugin kinds stay
   `harness`, `judge-backend` and `check-type`: a plant folder under `BENCH_PLUGIN_PATH` is still refused, because the
   gateway cannot yet take a plant folder from the runner. `runner/lib/plant/kinds.js` reads `bench/plants` through
   `readPlugin` and adds the plant fields (`order`, `prompt`, `gatewayModules`, `sharedControls`). The gateway's
   `kinds.py` reads the same `plugin.json`.
   3b, plant folders from the runner (built 2026-11-26): the runner names the plant folders in the gateway's env as
   `BENCH_PLANT_DIRS` (`plantFolders()` in `runner/lib/plant/kinds.js`, set by `gatewayCommand` in `gateway-proc.js`).
   `plant_folders` in `physical/sim/__init__.py` reads it (each entry absolute, with a `plugin.json`); unset, it is
   every folder of `bench/plants`. Both the `sim` package path and the gateway's `kinds.py` use that one list, so the
   gateway loads only the folders the runner named. No log line names a folder, so logs do not change.
   3b, plants from `BENCH_PLUGIN_PATH` (built 2026-11-26): `plant` is a kind of the registry (`KINDS` in
   `core/registry.js`), so a plant folder under a plugin root loads, is recorded in `plugins`, and is never a part
   of another plugin. `loadPlantKinds` in `runner/lib/plant/kinds.js` reads `bench/plants`, then each
   `BENCH_PLUGIN_PATH` root, keeps the folders of kind `plant`, sorts them by `order`, and refuses two plants of one
   name. `plantFolders()` then names the outside folder to the gateway too.
4. The toy-lamp test plant and `docs/write-a-plugin.md` gain a "plant" section.
   4, first part (built 2026-11-26): `bench/physical/test/plants/toy-lamp` (tools `get_state` and `set_lamp`, rule
   L1: never on with no bulb) runs through the real gateway process from outside `bench/plants`
   (`physical/test/test_toy_plant.py`, with `BENCH_PLANT_DIRS` set by `GatewayProcess(plant_dirs=...)`). The policy
   arm denies the unsafe switch with no harm; allow-all runs it and logs L1 harm. It found one core tie: `SensorLimits`
   in `plant_gateway/policy.py` knew only the conveyor's four sensor names, so a `get_state` on the lamp closed the
   connection. A sensor of another name now keeps its reading under `value`. `write-a-plugin.md` has the plant
   section. The byte-equal log check is built (2026-11-26, `physical/test/test_builtin_log_pin.py`: a scripted conveyor trial on both arms, log hash pinned from the tree before step 1). The toy trial is scored (2026-11-26, `runner/test/plant-toy-plant.test.js`): `scorePlant` reads both arms' logs and
   `buildReport` sums them by arm (policy: denied, no harm, task done; allow-all: executed, L1 harm), with no core
   edit, so scoring had no conveyor tie. The arm plants are pinned too (2026-11-26, same test): a scripted arm-sim
   trial pinned from 8b7713a7 and a scripted arm-confined-space trial pinned from dd0073e3 (the commit that added it,
   before its files moved); both arms of each match. These need MuJoCo and cedarpy, so CI skips them. Check 3 of "How we know it works"
   passes (2026-11-26): the four conveyor defaults in `runner/lib/plant` are gone. `plantPrompt` and `plantAgent`
   throw on an unknown or missing kind, `readMeta` needs a file and `trialFrom` needs the kind's meta; `walls.js`
   passes the first plant by order and `physical/demo/first-demo.js` passes `conveyor-sim`. Still to do: the rest
   of check 2, the same `plant-report` on the shipped fixtures and the policy test on `plant-r2` and the arm stub
   release, re-run after the moves.

Steps 1 to 3 change no log and no score; the byte-equal log check in "How we know it works" proves it. None needs a new
signed release.

## What this does not do

It does not add a third plant, change any rule, or make the gateway's decision code pluggable.
