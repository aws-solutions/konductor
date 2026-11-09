# Request: tags for notes

People keep a few dozen notes and cannot find anything. They want to label notes and list by label.

## Behaviour

- A note can carry tags. A tag is lowercase letters, digits and hyphens, 1 to 20 characters, and does
  not start with a hyphen. Input is trimmed and lowercased before it is checked, so `" Work "` becomes
  `work`. A note holds at most 5 tags and never the same tag twice.
- `add TEXT --tag T` attaches tags as the note is created. `--tag` may repeat. Tags keep the order they
  were given in, without repeats. If any tag is invalid, or there are more than 5, nothing is created and
  the next id is not used.
- `tag ID T` adds a tag to an existing note and prints `tagged ID #T`. Adding a tag the note already has
  is not an error and prints the same line.
- `untag ID T` removes a tag and prints `untagged ID #T`. A note without that tag is an error.
- `list --tag T` lists only the notes that carry `T` (after trimming and lowercasing). Without matches
  it prints `no notes`.
- `list` prints a third column for notes that have tags: a tab, then the tags as `#a #b`. Notes without
  tags print as before. `list --json` includes a `tags` array on every note, empty when there are none.

## Errors

| situation | exit code | message |
| --- | --- | --- |
| invalid tag | 2 | `error: invalid tag "X"` (X as the user typed it) |
| more than 5 tags on a note | 2 | `error: a note can have at most 5 tags` |
| missing arguments for `tag` or `untag` | 2 | the usage line |
| no note with that id | 3 | `error: no note with id N` |
| untag of a tag the note does not have | 3 | `error: note N has no tag "T"` |

## Storage

Files written by this release carry `"version": 2`. Files written by earlier releases (`"version": 1`,
notes without `tags`) must still load, and their notes have no tags. A failed command leaves the file as
it was.
