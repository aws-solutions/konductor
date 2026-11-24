# STANDARD: the paid run kit

STANDARD is the middle konductor run level: every DEV task that passes the lock and recheck gate. Its task list comes
from `../levels.js` (`--level standard` over `bench/suites/pack.json`). What the level is: [run levels](../../../docs/run-levels.md).

Run every kit script from your own terminal, never from an agent shell. The paid stages need the sandbox (`unshare`)
and spend credits or dollars.

| File | What it is | Cost |
| --- | --- | --- |
| `run-standard.sh` | The STANDARD run: every DEV task that passes the lock and recheck gate, three arms (vanilla, konductor, konductor-noskills), two stages of one replicate each. `--prepare-only` builds and trial-installs all three arms. The first paid start freezes the plan and the kit in the study dir. | free prepare; paid stages, 800 real credits cap per stage |
| `judge-standard.sh` | The three-family judge pass over the finished STANDARD units, then the three-arm report. `--plan` makes no model call. | paid, USD 15 cap |
| `claude-standard.sh` | Claude Code on 15 STANDARD tasks, plain and with konductor, one run each. `--prepare-only` makes no model call. | paid, USD 1 per run, USD 30 cap |
| `helper.js`, `test-*.sh` | The free helper (task gate, spend, stage check, tables) and the paid-path tests on stubs, run by `bench/runner/test/kit-standard.test.js`. | free |

Free gate check: `node bench/scenarios/konductor/standard/helper.js plan .` from the repo root prints the tasks that run
and the ones skipped, with the reason.
