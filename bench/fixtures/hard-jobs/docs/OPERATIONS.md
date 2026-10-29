# Operations notes

## Nightly batch

The batch runs at 02:00 with the default options and a dedupe store that lives for the whole run.

## Incident 2024-11 (open)

Finance reported that customer totals from the nightly batch sometimes differ from the ledger by a few
events, and that a re-run the next morning charged some events twice. Support also saw events that
never reached the ledger even though the handler was healthy. It does not reproduce on a developer
laptop, which suggests a timing problem in the worker pool.

Notes from the first investigation:

- The pool hands out work by index, so two workers can pick the same index. (Not verified.)
- The dedupe window is one hour.
- Retries use exponential backoff starting at 200 ms.
