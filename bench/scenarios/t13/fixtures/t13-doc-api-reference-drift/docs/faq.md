# FAQ

## Does a job need to be asynchronous?

No. A synchronous value or function is accepted, although promises are useful when the work is I/O-bound.

## Can a caller observe failures?

Use the failure callback and keep the returned promise under the caller's control.
