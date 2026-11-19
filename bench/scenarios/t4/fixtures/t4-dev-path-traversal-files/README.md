# Paper Lantern Share

Paper Lantern is a small document-sharing service for local teams. It keeps one folder per account below a configured storage directory and exposes a thin HTTP adapter around the storage handlers.

## Run

The service uses Node.js 24 and has no third-party packages.

```sh
npm test
npm start
```

Set `PAPER_LANTERN_ROOT` to choose the storage directory. The development default is `./var/files`.

## Handler API

The four storage operations live in `src/handlers.js`. Each accepts `(storageRoot, userId, input)` and returns a promise for an object with `status` and `body` fields. Upload input is `{ name, content, overwrite }`; download and listing use `{ path }`; archive import uses `{ archive }`. Content may be a string or Buffer.

`src/archive.js` contains the small archive reader and encoder used by the import operation. An archive begins with `T4AR1\n`, followed by repeated four-byte name length, eight-byte content length, UTF-8 name, and raw content records.

The HTTP layer in `src/server.js` is deliberately modest. Authentication is outside this example and the request header `x-account-id` supplies the caller account.
