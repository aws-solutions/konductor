# Pantry Path Orders API

This repository contains the public order API used by the meal-kit apps and the small queue publisher used by the shipping service.

## Local development

The service has no runtime dependencies. Node.js 24 or newer is required.

```sh
node --test
node src/server.js
```

The HTTP server listens on `PORT` (default `8080`). Data in `data/orders.json` is a small development snapshot; production uses the same store contract with a database adapter.

## Layout

- `src/routes` contains HTTP-shaped handlers and request dispatch.
- `src/store` contains the order and customer persistence boundary.
- `src/serialization` owns public JSON shapes.
- `src/events` owns queue messages.
- `docs/` records contracts shared with mobile and shipping teams.

The API keeps the handlers small so the mobile contract can be tested without opening a socket.
