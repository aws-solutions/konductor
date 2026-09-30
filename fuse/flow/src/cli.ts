// SPDX-License-Identifier: Apache-2.0
// fuse-flow command line: parse the arguments, run one command from
// commands.ts, print its lines. Exit codes: 0 success, 1 refused, 64 usage.

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import * as commands from "./commands.ts";
import { FlowError, UsageError } from "./errors.ts";
import { checkSlug, findRepoRoot, isWorkflowPath } from "./project.ts";

const USAGE = `usage:
  fuse-flow start <slug> [--workflow <name or path>]
                                                mint a workstream that follows the workflow, or resume it;
                                                prints the current step
  fuse-flow continue <slug> [--artifact <path>]...
                                                the current step's work is finished: record it and print
                                                the next step; refused unless the step's artifacts exist
                                                and its check command exits 0
  fuse-flow continue <slug> --owner-approved [--note <text>]
                                                the owner approved the current step, which awaited the
                                                owner or was blocked; record it and print the next step
  fuse-flow status <slug>                       show every step's state

workflows: a name is looked up as <name>.yml in .konductor/workflows/, ~/.konductor/workflows/,
           then the workflows that ship with fuse-flow; in each, at the top level and in the
           folders directly inside it (personal/, team/)
state:     .konductor/workstreams/<slug>.yml
env:       FUSE_SKILLS_DIR is searched first for the skill files steps name`;

// The options each command accepts. Anything else is a usage error.
const OPTIONS = {
  start: { workflow: { type: "string" } },
  continue: {
    artifact: { type: "string", multiple: true },
    "owner-approved": { type: "boolean" },
    note: { type: "string" },
  },
  status: {},
} as const;

type Command = keyof typeof OPTIONS;

function parse(command: Command, args: string[]) {
  let parsed;
  try {
    parsed = parseArgs({ args, options: OPTIONS[command], allowPositionals: true, strict: true });
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  if (parsed.positionals.length !== 1) throw new UsageError(`${command} takes <slug>`);
  checkSlug(parsed.positionals[0]);
  for (const [name, value] of Object.entries(parsed.values)) {
    if (value === "" || (Array.isArray(value) && value.includes(""))) throw new UsageError(`--${name} needs a value`);
  }
  return { slug: parsed.positionals[0], values: parsed.values as Record<string, string | string[] | boolean> };
}

function run(argv: string[]): string[] {
  const [command, ...args] = argv;
  if (command === "help" || command === "--help" || command === "-h") return [USAGE];
  if (!command || !Object.hasOwn(OPTIONS, command)) throw new UsageError(command ? `unknown command "${command}"` : "no command");

  const { slug, values } = parse(command as Command, args);
  const root = findRepoRoot(process.cwd());
  switch (command as Command) {
    case "start": {
      // A path is made absolute here, so the workstream still finds it when
      // a later command runs from another directory.
      const workflow = values.workflow as string | undefined;
      return commands.start(root, slug, workflow && isWorkflowPath(workflow) ? resolve(workflow) : workflow);
    }
    case "continue": {
      const ownerApproved = Boolean(values["owner-approved"]);
      if (values.note !== undefined && !ownerApproved) throw new UsageError("--note goes with --owner-approved");
      if (values.artifact !== undefined && ownerApproved) throw new UsageError("--artifact records the agent's work; it does not go with --owner-approved");
      return commands.continueWorkstream(root, slug, {
        ownerApproved,
        note: values.note as string | undefined,
        extraArtifacts: (values.artifact as string[] | undefined) ?? [],
      });
    }
    case "status":
      return commands.status(root, slug);
  }
}

function main(argv: string[]): number {
  try {
    for (const line of run(argv)) console.log(line);
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      console.log(`error: ${e.message}\n\n${USAGE}`);
      return 64;
    }
    if (e instanceof FlowError) {
      console.log(`refused: ${e.message}`);
      return 1;
    }
    // A file fuse-flow cannot read or write. Node's message names the
    // operation and the path, which is all the user needs.
    if (e instanceof Error && "syscall" in e) {
      console.log(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

process.exit(main(process.argv.slice(2)));
