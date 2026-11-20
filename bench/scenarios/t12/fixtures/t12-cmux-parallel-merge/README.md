# shelf

A reading list on the command line: `shelf add 320 The Dispossessed`, `shelf list`, `shelf done b1`.
`run(argv, store)` in `src/cli.js` is the whole CLI; `src/store.js` keeps the books in memory.

Tests: `npm test` (`node --test test/*.test.js`).
