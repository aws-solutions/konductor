# LITE

LITE is the smallest konductor run level: about 16 DEV tasks, one per phase plus a twin and a control, and every task
changed since the last LITE. It is a check after a change, not a verdict. What the level is:
[run levels](../../../docs/run-levels.md).

LITE has no kit of its own. Its task rules are in `../levels.js`. It runs through the generic runner:

```
node bench/runner/bench.js run --suite pack --level lite --arms vanilla,main --budget-credits N --out OUT
```

Add `--prepare-only` for a free check.
