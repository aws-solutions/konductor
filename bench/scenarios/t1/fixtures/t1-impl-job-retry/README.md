# Fulfilment worker

This small Node.js worker drains a file-backed queue of order fulfilment jobs. It currently handles inventory synchronisation and shipment creation jobs.

## Running

The project targets Node.js 24 and has no runtime dependencies. Run `node --test` for the checks or `npm start` to run the worker with `config/default.json`.

## Queue records

Jobs contain an `id`, a `type`, a `payload`, and an `attempts` counter. Queue files have `pending` and `deadLetter` arrays. The queue inspection command prints pending records in a readable form.

Operational notes are in `docs/operations.md`; supported job payloads are in `docs/jobs.md`.
