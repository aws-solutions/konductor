# orders-api release folder

Working folder of the Basketry orders team for releases of `orders-api`, the service behind the grocery app's cart,
delivery slots and checkout. Four hosts (`oa-1` to `oa-4`) sit behind the edge proxy.

| Folder | What is in it |
| --- | --- |
| `release/` | release notes, the rollout plan and state, the deploy history |
| `runbooks/` | how we roll out and roll back |
| `db/` | schema migrations and the migration policy |
| `ci/` | the latest build results |
| `metrics/` | the per-minute export and the metric catalogue |
| `dashboards/` | snapshots of the overview dashboard |
| `logs/` | today's logs: one file per orders-api host, the payments gateway and the edge proxy |
| `vendor/` | status notes from suppliers |
| `chat/` | export of the release channel |
| `comms/` | who we keep informed during a release |
| `docs/`, `notes/` | architecture, SLOs, older notes |

Times are UTC everywhere.
