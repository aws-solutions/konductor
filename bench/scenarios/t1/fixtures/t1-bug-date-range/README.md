# Cedar Rooms

Cedar Rooms is a small, file-backed room-booking service. It is used by the
front desk team for three meeting rooms and one training room.

## Requirements

- Node.js 24 or newer
- No service process or database is required for local use

## Commands

Run the checks with:

```sh
node --test
```

Print a monthly report from a booking file with:

```sh
node src/cli.js report --month 2025-04 --file data/bookings.json
```

The report command prints JSON to standard output. A booking file is an array
of objects with `id`, `room`, `start`, `end`, and `name` fields. Dates may be
calendar dates such as `2025-04-14` or ISO date-time strings.

See [the data format notes](docs/data-format.md) and [the operations guide](docs/operations.md)
for examples and small maintenance tasks.
