# Operations guide

The booking file is deliberately portable. Before editing it by hand, make a
copy in the same directory. The report command is read-only and is suitable for
an operator's workstation.

To inspect a file without changing it:

```sh
node src/cli.js report --month 2025-04 --file data/bookings.json
```

Malformed JSON is reported on standard error and returns a non-zero exit code.
