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
                                                mint a workstream that follows the workflow, or resume it
  fuse-flow next <slug>                         print what to do for the next step
  fuse-flow done <slug> <step> [--artifact <path>]...
                                                record a step as finished; refused unless its artifacts
                                                exist and its check command exits 0
  fuse-flow gate <slug> <step> --owner-approved [--note <text>]
                                                record the owner's approval of a waiting or blocked step
  fuse-flow status <slug>                       show every step's state

workflows: a name is looked up as <name>.yml in .konductor/workflows/, ~/.konductor/workflows/,
           then the workflows that ship with fuse-flow
state:     .konductor/workstreams/<slug>.yml
env:       FUSE_SKILLS_DIR is searched first for the skill files steps name`;

// The options each command accepts. Anything else is a usage error.
const OPTIONS = {
  start: { workflow: { type: "string" } },
  next: {},
  done: { artifact: { type: "string", multiple: true } },
  gate: { "owner-approved": { type: "boolean" }, note: { type: "string" } },
  status: {},
} as const;

const ARGUMENTS = { start: ["slug"], next: ["slug"], done: ["slug", "step"], gate: ["slug", "step"], status: ["slug"] };

type Command = keyof typeof OPTIONS;

function parse(command: Command, args: string[]) {
  let parsed;
  try {
    parsed = parseArgs({ args, options: OPTIONS[command], allowPositionals: true, strict: true });
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  const expected = ARGUMENTS[command];
  if (parsed.positionals.length !== expected.length) {
    throw new UsageError(`${command} takes ${expected.map((a) => `<${a}>`).join(" ")}`);
  }
  checkSlug(parsed.positionals[0]);
  for (const [name, value] of Object.entries(parsed.values)) {
    if (value === "" || (Array.isArray(value) && value.includes(""))) throw new UsageError(`--${name} needs a value`);
  }
  return { positionals: parsed.positionals, values: parsed.values as Record<string, string | string[] | boolean> };
}

function run(argv: string[]): string[] {
  const [command, ...args] = argv;
  if (command === "help" || command === "--help" || command === "-h") return [USAGE];
  if (!command || !Object.hasOwn(OPTIONS, command)) throw new UsageError(command ? `unknown command "${command}"` : "no command");

  const { positionals: [slug, step], values } = parse(command as Command, args);
  const root = findRepoRoot(process.cwd());
  switch (command as Command) {
    case "start": {
      // A path is made absolute here, so the workstream still finds it when
      // a later command runs from another directory.
      const workflow = values.workflow as string | undefined;
      return commands.start(root, slug, workflow && isWorkflowPath(workflow) ? resolve(workflow) : workflow);
    }
    case "next":
      return commands.next(root, slug);
    case "done":
      return commands.done(root, slug, step, (values.artifact as string[] | undefined) ?? []);
    case "gate":
      if (!values["owner-approved"]) throw new UsageError("gate records the owner's approval; pass --owner-approved");
      return commands.gate(root, slug, step, values.note as string | undefined);
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
