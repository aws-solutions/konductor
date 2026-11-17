# Operations

The service runs behind the ticket web server. Each request calls `book` once.

- Payment gateway answers usually take 200 to 800 ms. The gateway does not stop a charge on its own when the caller
  goes away; it stops when the `signal` it was given is aborted.
- The store is shared by the calls of one server process. This package runs one process per host, so locks held in
  memory are enough here.
- Confirmation mail is sent by `notifier.send`. The mail relay fails a few times per day.
