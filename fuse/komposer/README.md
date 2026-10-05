# Komposer

Komposer is a local editor for fuse-flow workflows. It shows a workflow as a diagram, edits it
without disturbing the file's comments and layout, and shows the runs of the project's
workstreams. It reads and writes the workflow files on disk, in all three places fuse-flow looks:

- the project's `.konductor/workflows/`;
- your own `~/.konductor/workflows/`;
- the workflows that ship with fuse-flow, in `fuse/flow/workflows/`.

The Library tab shows the artifact library from the same three levels.

## Running it

You need [Bun](https://bun.sh) 1.3 or later. From this folder, the first time:

```bash
bun install
bun run build
```

Then start it on a project, which is any git repository:

```bash
bun run start -- <project directory>
```

Leave the directory out to use the current one. The command prints a URL with a token, such as
`http://127.0.0.1:4807/#token=...`; open it in your browser. `--port <n>` picks another port.

Run `bun run build` again after pulling changes. For working on Komposer itself, `bun run dev`
serves the app with Vite on port 5173 and passes `/api` to the server started with `bun run start`.

## What to know

- **Edits are kept as a working copy** in the project's `.konductor/editor/` folder, which git
  ignores, until you choose Save. Save either updates the original file or saves a new one. If
  the file changed on disk in the meantime, Komposer asks before overwriting it.
- **Saving a workflow that a workstream is following** affects that workstream, because fuse-flow
  reads the workflow again on every command. Komposer warns you when a save moves or renames
  steps that a running workstream depends on.
- **The server is for your machine only.** It listens on 127.0.0.1, requires the token from the
  printed URL, refuses requests that come with another host name, and writes only `.yml` files in
  the three workflow folders and its own working-copy folder.
- **Known limitation:** comments inside a flow list (`[...]`) that spans several lines are lost
  when an item of that list is added, removed or moved, or when a gate in it is edited. No shipped
  workflow uses that form.

## Tests

```bash
bun test          # the server's API and the YAML editing, end to end
bun run typecheck
```
