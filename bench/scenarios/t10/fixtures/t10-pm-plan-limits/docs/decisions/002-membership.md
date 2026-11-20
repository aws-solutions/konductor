# ADR 002: membership states

## Status

Accepted.

## Decision

A membership moves from invited to active when the invite is accepted. Removing a member records a removed state instead of deleting history. Duplicate active membership is rejected, while a removed member may be invited again.

## Consequences

List endpoints must choose whether they mean current members or membership history. The service keeps the state transition rules outside the HTTP layer.
