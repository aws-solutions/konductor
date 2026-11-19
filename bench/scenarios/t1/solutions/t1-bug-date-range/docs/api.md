# Local API notes

The service is intentionally made of small CommonJS modules. The command-line
entry point is `src/cli.js`; the storage and calculations can also be used by a
small script.

A booking has an `id`, `room`, `start`, `end`, and `name`. The JSON store keeps
those keys unchanged. Booking intervals use an exclusive end, so a booking
ending at midnight does not occupy the following calendar day. The report uses
a `YYYY-MM` month selector and emits a JSON object whose `days` array contains
every date in that month.
