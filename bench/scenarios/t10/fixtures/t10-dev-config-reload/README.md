# Harbor Hand Worker

Harbor Hand accepts small delivery jobs from the quay queue and runs them with a bounded pool of Node workers. It is deliberately boring: files hold deploy-time settings, the queue adapter owns acknowledgement, and the HTTP surface is for probes and operators.

## Development

The service runs directly on Node 24, which can strip erasable TypeScript syntax. There is no compile step or package install. Run `npm test` or `node --test` from the repository root. The two checks in `scripts/` are also run by CI.

Configuration is kept in `config/`. The worker reads its settings at process start. Environment names and precedence are documented in `docs/config.md`; keep local values out of source control.

The team uses small decision records in `docs/decisions/`. Operational names and units live in `ops/metrics.csv`, while deployment audiences live in `ops/rings.json`.
