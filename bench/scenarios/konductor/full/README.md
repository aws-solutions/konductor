# FULL

FULL is the largest konductor run level: every task in the pack. It is the only level that may give a verdict, and the
verdict comes from the HELD-OUT tasks only. What the level is: [run levels](../../../docs/run-levels.md).

FULL has no kit of its own. Its task rule is in `../levels.js`. A FULL run must be pre-registered first
(`scenarios prereg freeze`), then:

```
node bench/runner/bench.js run --suite pack --level full --prereg FILE ...
```
