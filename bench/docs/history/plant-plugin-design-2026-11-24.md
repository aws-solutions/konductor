# Design: plants as plugins

Date: 2026-11-24. Status: steps 1 and 2 built, step 3a built (2026-11-25; see BACKLOG B-003). Row: BACKLOG B-003 (DEBT D-111 and D-207 are closed).

## The problem

The bench has two plants: the conveyor and the robot arm. A third plant (a mixer, a crane, a warehouse robot) means
edits in five core files, in two languages:

| file | what it holds per plant |
| --- | --- |
| `bench/physical/gateway/plant_gateway/kinds.py` | `KINDS`: the `PlantKind` (simulator, tools, rules, Cedar context, limits check) |
| `bench/runner/lib/plant/meta.js` | `KIND_META`: the plant's metadata file (`schemas/plant-meta-*.json`: tools, rules, fields) |
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
  plant.json        { "benchApi": 1, "kind": "plant", "name": "arm-sim", "version", "meta", "python", "prompt",
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
| `python` (`kind.py`) | `KINDS` in `kinds.py`: the gateway imports `KIND` from the file with `importlib`, by path |
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
   3a (built 2026-11-25): each kind's Node record is a `bench/plants/<kind>/plant.json` (`benchApi`, `kind: "plant"`,
   `name`, `order`, `meta`, `prompt`, `gatewayModules`, `sharedControls`), read and checked by
   `runner/lib/plant/kinds.js`, which no longer names a kind. `meta` still points at `physical/schemas`, and
   `sharedControls` stands in for `controls.js`. Left for 3b: move `meta.json`, `kind.py` and the simulator into the
   folders (Python reads them too), read the folders through `core/registry.js`, and record each folder hash.
4. The toy-lamp test plant and `docs/write-a-plugin.md` gain a "plant" section.

Steps 1 to 3 change no log and no score; the byte-equal log check in "How we know it works" proves it. None needs a new
signed release.

## What this does not do

It does not add a third plant, change any rule, or make the gateway's decision code pluggable.
