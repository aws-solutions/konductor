# Testing

The project uses the built-in `node:test` runner. Run `node --test` from the repository root. Tests use the websocket stub rather than a network socket and keep their intervals short or stop the service before returning.

The test configuration is data only; source modules do not read it automatically. This keeps library construction explicit in scripts and applications.
