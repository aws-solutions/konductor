# Improve points movement handlers

## What changed

This revision updates the earn, redemption, staff adjustment, and nightly
maintenance handlers. It also adds API notes and focused coverage for the new
routes and tier combinations.

## Why

Checkout traffic needs the service to recover from short transient failures,
and support tooling needs a small balance adjustment operation. The maintenance
path now keeps its date comparison local to the job invocation.

## Tested

- `node --test`
- Manual earn, redeem, adjustment, and expiry examples
- Node.js 24 in CI
