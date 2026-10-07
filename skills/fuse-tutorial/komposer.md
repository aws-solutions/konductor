# Komposer in the tutorial

Two parts of the tutorial use Komposer: opening it, and building a first personal workflow in it.
`SKILL.md` says when to use each. `<clone>` and `<run>` are as defined there.

## Build and open Komposer

Komposer is a local web app that edits fuse-flow workflows and shows the runs of a project's
workstreams. This part takes three messages: what Komposer is, the setup, and how to open it.

**First message: what Komposer is.** Tell the user, at their level. The three points below are the
material; at the default level, one or two sentences each is enough, and the rest waits for "more":

- **Where it lives:** `<clone>/fuse/komposer`, a React app with a small server, both in the
  fuse-konductor clone. Its `README.md` there describes it.
- **What it is:** a convenience layer over files. The server runs on the user's machine only,
  serves the built app, and reads and writes files on disk; there is no database and nothing
  leaves the machine. The workflows are the YAML files in the three workflow folders, and the
  library is folders of Markdown and YAML files. Komposer only reads a project's workstream state.
- **What that means for the user:** anything Komposer does, they could do by editing the YAML by
  hand, and they can mix the two. Komposer keeps comments and layout when it edits a file, keeps
  unsaved edits as a working copy in the project's `.konductor/editor/` (ignored by git) until
  they save, and notices when a file changes on disk.

End with the offer: more on how Komposer works with the files, or move on to setting it up.

**Second message: the setup.** Do it yourself. Show each command as you run it, so the user can
repeat it later without you:

1. Create the playground once: `git init` in `~/.konductor/tutorials/<run>/playground`, add a
   one-line `README.md`, and commit it. When the run works on a real project instead, use that
   project's directory below and skip this step.
2. Build Komposer: in `<clone>/fuse/komposer`, run `bun install`, then `bun run build`. If either
   fails, show the user the error and stop; do not try to repair the clone.
3. Start the server in the background on the playground, so it keeps running while you talk:
   `bun run start -- ~/.konductor/tutorials/<run>/playground --port <port>`, with its output going
   to `~/.konductor/tutorials/<run>/komposer.log`. Use port 4807 for the first run. If the log says
   the port is in use, which happens when another run is going, try the next port up. Record the
   port in `state.yml`.
4. Read the URL from the log. It looks like `http://127.0.0.1:4807/#token=...`; the token is part
   of it, so give the whole URL.

Then tell the user, in one short paragraph, how to do it themselves in any project: from
`<clone>/fuse/komposer`, `bun install && bun run build` once (and again after pulling changes),
then `bun run start -- <project directory>`, and open the URL it prints. The server stops when they
stop the command. Hold back the token's purpose (it keeps other web pages in their browser from
using the server) for "more".

**Third message: open it.** Hand the URL to the user:

- If your harness can open a browser that the user can see, such as a browser panel or a browser
  the user has attached, open the URL there and keep using that page; you can then check what the
  user sees and point at things by their labels.
- Otherwise ask the user to open the URL in their browser. If they work on a remote machine, the
  browser runs on their own computer, so they first need the port forwarded, for example
  `ssh -L 4807:127.0.0.1:4807 <remote host>`, and then open the URL with `127.0.0.1`.

Ask them to say "done" when they see Komposer: a list of workflows on the left, a diagram in the
middle and an inspector on the right. If they see an error or a blank page, read `komposer.log`.

## Build a first personal workflow

The user builds a two-step workflow, "draft and review": a step that writes a short document and
waits for their approval, then a step that implements it and is checked and reviewed. Use the file
name `tutorial-<run>`, so runs in parallel do not collide.

Give one instruction at a time, name the exact label to click, and wait for "done" before the next.
After each "done", check what you can: if you control the browser, look at the page; otherwise ask
what they see when something matters. Celebrate briefly, never at length. The steps:

1. Click the **+** button next to "Search workflows". In "New workflow", choose **personal**, type
   `tutorial` as the **Folder** and `tutorial-<run>` as the **File name**, and click **Create**.
   The diagram shows one step, `new-step`, and a problem: its instruction is empty.
2. Click the step card. In the Step tab on the right, set **Title** to `Draft` and **ID** to
   `draft`. Leave the instruction empty for now.
3. Open the **Library** tab. It lists the artifact library: kinds of documents, each with a guide
   (G), a template (T) and a review guide (R). Find `design-spec` and click its **+** button to add
   it to the step. Back in the Step tab, the instruction is now filled in from the library's
   description of `design-spec`, and the problem is gone. Explain that the output's guide tells the
   agent how to write that kind of document.
4. In the Step tab, under **Gates**, click **+ owner-action** and type `approve the spec`. This
   step now waits for the user's approval.
5. Click **+ Append step** below the diagram. Set its **ID** to `implement` and its instruction to
   `Implement the approved spec, with tests.`
6. Under **Consumes**, click `design-spec`, so this step reads the spec. An arrow appears in the
   diagram.
7. Under **Outputs**, type `code` and click **Add**. Komposer suggests the path `.`, the whole
   repository. Change its mode from `produces` to `updates`: the step changes the repository's
   code instead of creating a file.
8. Under **Gates**, click **+ check** (the text is `default`: the project's own check command,
   which fuse-flow asks for the first time) and then **+ agent**, with the text
   `review the change against the spec`. Point out "reviews against" under the agent gate: which
   review guide applies to each artifact.
9. Open the **YAML** tab and show the user the file Komposer wrote. Mention that Komposer keeps
   comments and layout when it edits a file.
10. Click **Save…** at the top, then **Save** in the dialog. The workflow is now listed under
    Personal, in the `tutorial/` folder. Then check the file yourself: run
    `<clone>/fuse/flow/fuse-flow validate ~/.konductor/workflows/tutorial/tutorial-<run>.yml` and
    tell the user the result. Record `workflow_path` and set `built_workflow: true`.

If a click does not produce what you described, ask what they see, and adapt; the labels above
are Komposer's at the time of writing. If the user wants to try something else on the way, let
them, and help.
