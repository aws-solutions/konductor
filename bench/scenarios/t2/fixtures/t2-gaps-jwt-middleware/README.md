# Roster API

Roster is the small internal API behind the team's shift board. It stores users and shifts as JSON while the service is being migrated to the shared database. The HTTP layer is deliberately thin so route behavior can be tested without starting a port.

## Development

Use Node.js 24 or newer. The repository has no runtime dependencies.

```sh
npm test
npm start
```

The default server listens on `127.0.0.1:4100`. Test fixtures use the values in `config/test.json`; no real credentials belong in this repository.

## Endpoints

`GET /health` is public. The schedule and administration endpoints use the session cookie until the bearer-token migration is complete. See `docs/authentication.md` for the token contract.
