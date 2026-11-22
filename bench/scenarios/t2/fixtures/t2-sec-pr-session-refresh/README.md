# Harbor account service

A small account and session service used by the Harbor web application. It keeps the runtime simple: Node.js built-ins, newline-delimited request logs, and a file-backed store for local development.

## Requirements

- Node.js 24 or newer
- No package install is needed

## Commands

```sh
node --test
npm run check
```

The HTTP adapter is thin. `src/app.js` exports a request handler so the tests can exercise authentication without binding a port. The example server in `src/http.js` is useful when manually trying the endpoints.

## Development data

The JSON files in `src/data/` are sample records only. A process started from this repository does not write back to those files. Production deployments provide an account repository and a session repository with the same small interfaces.

## API outline

`POST /login` accepts an email, password, and optional `rememberMe` flag. Successful login returns a session cookie. `POST /refresh` accepts the refresh cookie and returns a replacement cookie. `POST /logout` ends the current login. `POST /password` changes the signed-in account password. `POST /password-reset/request` creates a reset link for a known address.

See `docs/api.md` for request shapes and `docs/session-policy.md` for the behavior expected by clients.
