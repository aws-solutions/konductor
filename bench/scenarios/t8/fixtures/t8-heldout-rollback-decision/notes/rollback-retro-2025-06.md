# Retro: the 4.9.0 rollback (2025-06-12)

We rolled 4.9.0 back after a slot booking bug. The rollback broke slot search for 50 minutes: migration 0031 had
already dropped `delivery_slots.legacy_slot_id`, and 4.8.x still read it. We had to roll forward with a hot build.

What we changed:
- Migrations are expand-only per release; removals wait for a later release (see `db/README.md`).
- The rollback runbook now starts with a migration check.
