# T3 dropped tasks

Tasks removed from the pack after a fix round (FX job, 2026-11-20) that still failed the non-Claude recheck or a free gate. The files are not kept in the tree.

| task | writer | reason |
| --- | --- | --- |
| t3-dev-lib-choice | deepseek-3.2 | the fix by deepseek-3.2 (a regex flag in the hidden test) brought the reference to 100, but the gpt-5.6-luna recheck failed key-matches-fixture and solvable-from-fixture: the expert key's 45 cores for JSON (50,000 x 0.9 ms) conflicts with fixture/load-test-results.md:23, which gives 4.5 cores per 10,000 events/s |
| t3-nfr-capacity-autoscale | deepseek-3.2 | the fix by the original writer failed a free gate: {"id":"t3-nfr-capacity-autoscale","reference":74,"stub":0,"lazy":21,"alt":74,"deterministic":true}  |
| t3-sre-log-retention | deepseek-3.2 | the fix by the original writer failed a free gate: [ { "id": "t3-sre-log-retention", "repeat": 3, "scores": { "reference": 100, "stub": 0, "lazy": 100, "alt": 100 }, "deterministic": true, "canary": null, "loadErrors": [], "timeouts": false, "errors": [], "gates": { "loads": tru |
