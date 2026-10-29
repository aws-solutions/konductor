# Operations notes

## Nightly batch

The batch runs at 02:00 with the default options and a dedupe store that lives for the whole run.

## Incident 2024-11 (open)

Finance reported that customer totals from the nightly batch sometimes differ from the ledger by a few
events, and that a re-run the next morning charged some events twice. Support also saw events that
never reached the ledger even though the handler was healthy. Causes found
(see the Unreleased section of CHANGELOG.md): the same id handled by two workers at once, dedupe entries that never expired,
a retry loop one attempt short, totals shared between calls, and a dedupe TTL configured in seconds.

Notes:

- The pool hands out each index once; it was not at fault.
- The dedupe window is one hour (3600000 ms).
- Retries use exponential backoff starting at 200 ms.
