# Parcel Rate Service

Parcel Rate Service loads a small carrier rate table and exposes quote logic used by the checkout API. The service keeps the carrier adapter narrow so it can run in a local process or behind the HTTP wrapper.

## Run it

This project uses Node.js 24 and has no third-party packages.

```sh
node --test
node src/server.js
```

The server listens on `PORT`, defaulting to 8080. Set `NODE_ENV=production` to use the production carrier settings. The local configuration uses a fake carrier endpoint and fake credentials.

## Quote input

A quote contains an origin, destination, and `weightKg`. Postal codes are strings because some regions use leading zeroes. The destination country defaults to `US` only at the HTTP boundary; library callers should provide it explicitly.
