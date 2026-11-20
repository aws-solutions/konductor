# Database migrations

Migrations run before the new code starts, so both versions run against the same schema during a rollout.

Policy since 2025-07 (after the 4.9 rollback): a release ships expand-only migrations. A column is removed or
tightened in a later release, once no running version reads it.

Each migration file starts with a comment naming the release it shipped in.
