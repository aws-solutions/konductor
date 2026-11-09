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
| `add TEXT [--tag T]...` | save a note (1 to 280 characters), with optional tags, and print `added ID` |
| `list [--tag T]` | print one note per line as `ID`, a tab and the text, then a tab and the tags when there are any; `no notes` when nothing matches |
| `list --json` | print the notes as a JSON array |
| `tag ID T` | add a tag to a note and print `tagged ID #T` |
| `untag ID T` | remove a tag from a note and print `untagged ID #T` |
| `delete ID` | remove a note and print `deleted ID` |

## Tags

Tags label notes so you can find them again. A tag is 1 to 20 lowercase letters, digits or hyphens and does not start with a hyphen. Capital letters and surrounding spaces are fixed for you, so `Work` becomes `work`. A note holds up to 5 tags.

```
$ node src/cli.js add "plan the trip" --tag travel --tag Ideas
added 1
$ node src/cli.js add "call the bank"
added 2
$ node src/cli.js tag 2 money
tagged 2 #money
$ node src/cli.js list
1	plan the trip	#travel #ideas
2	call the bank	#money
$ node src/cli.js list --tag ideas
1	plan the trip	#travel #ideas
$ node src/cli.js untag 1 ideas
untagged 1 #ideas
```

An invalid tag stops the command with exit code 2 and changes nothing. `untag` on a tag the note does not have exits with 3.

## Exit codes

| code | meaning |
| --- | --- |
| 0 | done |
| 2 | bad usage or invalid input, including a bad tag or more than 5 tags |
| 3 | no note with that id, or the note does not have that tag |
| 1 | anything else |

Errors go to stderr as `error: MESSAGE`.

## Storage

`notes.json` holds `{ "version": 2, "nextId": N, "notes": [...] }`. Each note has `id`, `text`, `tags` and `createdAt`. Ids are never reused. Files from earlier releases (`"version": 1`, no tags) still load; their notes have no tags, and the file is rewritten as version 2 on the next change.

## Layout

- `src/cli.js`: argument parsing and output.
- `src/service.js`: note operations.
- `src/validate.js`: input rules, including tags.
- `src/store.js`: reads and writes the JSON file and upgrades old files.

Run the tests with `npm test`.
