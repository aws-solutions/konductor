# Operations notes

The service is normally run behind a process supervisor with stdout collected as JSON lines. The process is stateless while using the bundled seed data; a deployment that needs writes should provide a configured file store.

Health checks should request `/healthz`. A healthy process returns `200` and a short JSON body. The application does not expose metrics or administrative routes.
