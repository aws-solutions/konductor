# HTTP notes

The service accepts JSON uploads at `POST /files` and reads files at `GET /files?path=...`. Folder names are returned by `GET /folders?path=...`. The account is supplied by `x-account-id` in this example deployment.

Archive handoffs are sent as the raw body of `POST /imports`. The archive encoder in `src/archive.js` is useful for local tools.
