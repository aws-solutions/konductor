# notes-cli

A tiny notes tool that keeps notes in one JSON file.

## Install and run

No install step. Run it with Node 18 or later:

```
$ node src/cli.js add "buy milk"
added 1
$ node src/cli.js list
1	buy milk
$ node src/cli.js delete 1
deleted 1
```

Notes live in `notes.json` in the current directory. Set `NOTES_FILE` to use another file.

## Commands

| command | what it does |
| --- | --- |
| `add TEXT` | save a note (1 to 280 characters) and print `added ID` |
| `list` | print one note per line as `ID`, a tab and the text, or `no notes` |
| `list --json` | print the notes as a JSON array |
| `delete ID` | remove a note and print `deleted ID` |

## Exit codes

| code | meaning |
| --- | --- |
| 0 | done |
| 2 | bad usage or invalid input |
| 3 | no note with that id |
| 1 | anything else |

Errors go to stderr as `error: MESSAGE`.

## Storage

`notes.json` holds `{ "version": 1, "nextId": N, "notes": [...] }`. Each note has `id`, `text` and `createdAt`. Ids are never reused.

## Layout

- `src/cli.js`: argument parsing and output.
- `src/service.js`: note operations.
- `src/validate.js`: input rules.
- `src/store.js`: reads and writes the JSON file.

Run the tests with `npm test`.
