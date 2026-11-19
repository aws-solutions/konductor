# Architecture

`server.js` translates HTTP requests into calls to `handlers.js`. The handlers own file operations and return small response objects. `archive.js` is intentionally independent so maintenance tools can use the same format without starting the server.
