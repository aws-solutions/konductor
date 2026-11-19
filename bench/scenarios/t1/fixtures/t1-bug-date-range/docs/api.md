# Local API notes

The service is intentionally made of small CommonJS modules. The command-line
entry point is `src/cli.js`; the storage and calculations can also be used by a
small script.

A booking has an `id`, `room`, `start`, `end`, and `name`. The JSON store keeps
those keys unchanged. The report uses a `YYYY-MM` month selector and emits a
JSON object whose `days` array contains the dates in that month.
