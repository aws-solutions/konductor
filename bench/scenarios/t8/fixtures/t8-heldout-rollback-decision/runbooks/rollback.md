# Rolling back orders-api

Owner: orders team. Last reviewed 2026-09.

## Before you start

1. List every migration shipped after the version you go back to (`db/migrations/`, each file names its release).
2. A rollback is safe only when all of them are expand-only: new tables, new nullable columns, new indexes. The old
   version never reads what it does not know about.
3. A migration that drops, renames or tightens a column (NOT NULL, a new constraint) blocks the rollback until a
   compatible build exists. Talk to the orders team lead.
4. Features that shipped in the release go away with it. Tell the owners of anything that depends on them.

## Steps

1. Freeze the rollout (`deployctl freeze orders-api`).
2. `deployctl rollback orders-api --to <version> --hosts <hosts>`; hosts drain for 3 minutes each, two at a time.
3. Two hosts take about 8 minutes, the whole fleet about 15.
4. Watch the metric that showed the problem until it is back at the old version's level for 15 minutes.
5. Post in the release channel and the status channel.

## Rolling forward instead

Only with a build that is green in CI and has run on one host for 15 minutes. Never skip CI to roll forward.
