# Northstar Returns Service

A small internal service for return requests attached to individual order lines. The current package is intentionally modest: it keeps the domain object separate from transport code and stores money as integer cents.

## Local use

The service has no third-party runtime packages. Run the checks with:

    node --test test/*.test.js

The sample HTTP adapter is a thin boundary for a future shop application. It is not a production server and does not own payment credentials.

## Design material

The returns team keeps the latest lifecycle sketch in `docs/design/returns-whiteboard.png`. The short note beside it records the meeting context; the image is the detailed artifact.
