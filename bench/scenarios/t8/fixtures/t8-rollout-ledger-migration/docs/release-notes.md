# Ledger API 3.0 release notes

## Scope

Ledger API 3.0 adds `settlement_route` to `ledger_entries`. The field is nullable during the expand phase, and 3.0 writes it for new settlement entries and reads it when selecting a route. The release also removes the old route-selection branch after all production hosts run 3.0.

The existing `settlement_code` column remains part of the compatibility surface during the rollout. The 2.x settlement handler expects a value there when it receives an entry. Do not remove or change that column until the compatibility period is complete.

## Database sequence

Run `migrations/001_expand.sql`, then `migrations/002_prepare.sql`, and only after the application rollout has completed run `migrations/003_contract.sql`. The first two scripts are safe while 2.x hosts remain in service. The last script is not.

## Service dependencies

`ledger-api` calls `payment-authorizer` on settlement requests and publishes completed entries to `reconciliation`. A successful API response does not prove that either downstream queue is caught up. Watch their metrics while traffic moves.

## Compatibility note

The old handler is not tolerant of a null `settlement_code` on a touched row. The prepare migration supplies the compatibility value before 3.0 traffic is introduced. The release owner must verify the null-row count reaches zero before the first canary.
