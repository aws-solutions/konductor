// SPDX-License-Identifier: Apache-2.0
// fuse-flow command line: parse the arguments, run one command from
// commands.ts, print its lines. Exit codes: 0 success, 1 refused, 64 usage.

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import * as commands from "./commands.ts";
import { FlowError, UsageError } from "./errors.ts";
import { checkSlug, findRepoRoot, isDirectory, isWorkflowPath } from "./project.ts";

const USAGE = `usage:
  fuse-flow start <slug> [--workflow <name or path>] [--from <step>]
                                                mint a workstream that follows the workflow, or resume it;
                                                prints what to do now. --from starts a new workstream at a
                                                later step, as the owner's decision
  fuse-flow continue <slug> [--updated <file>]... [--unchanged <artifact> <reason>]...
                            [--not-produced <artifact> <reason>]...
                                                the current step's work is done: refused until every artifact
                                                it produces exists or is reported --not-produced, every
                                                artifact it updates is accounted for, and its checks pass
  fuse-flow continue <slug> --blocked <why>     the agent cannot finish the step, for example at the review
                                                round cap; the owner decides
  fuse-flow continue <slug> --skip <why>        skip the step: its condition does not hold, or the owner asked
  fuse-flow continue <slug> --owner-approved [--note <text>]
                                                the owner approved a step that awaits the owner or is blocked
  fuse-flow continue <slug> --more-rounds <n> [--note <text>]
                                                the owner grants the step's agent gates n more review rounds
  fuse-flow continue <slug> --back-to <step> [--note <text>]
                                                the owner sends the work back from a step that awaits the owner
                                                or is blocked to <step>, it or an earlier one
  fuse-flow continue <slug> --forward-to <step> [--note <text>]
                                                the owner jumps forward; the steps passed over are skipped
  fuse-flow status <slug>                       show every step's state
  fuse-flow validate <name, file or directory>...
                                                check workflows without starting a workstream; a
                                                directory stands for every .yml and .yaml file below
                                                it, so \`fuse-flow validate .\` checks them all

workflows: a name is looked up as <name>.yml in .konductor/workflows/, ~/.konductor/workflows/,
           then the workflows that ship with fuse-flow; in each, at the top level and in the
           folders directly inside it (personal/, team/)
library:   artifact guides in .konductor/library/artifacts/<id>/, ~/.konductor/library/artifacts/<id>/,
           then the library that ships with fuse-flow
policy:    ~/.konductor/policy-overrides.yml, .konductor/policy-overrides.yml,
           .konductor/policy-overrides.local.yml; each overrides the ones before it
state:     .konductor/workstreams/<slug>.yml`;

// The options each command accepts. Anything else is a usage error.
// --unchanged and --not-produced take two values each and are read before
// these, by takePairs.
const OPTIONS = {
  start: { workflow: { type: "string" }, from: { type: "string" } },
  continue: {
    updated: { type: "string", multiple: true },
    "owner-approved": { type: "boolean" },
    blocked: { type: "string" },
    skip: { type: "string" },
    "more-rounds": { type: "string" },
    "back-to": { type: "string" },
    "forward-to": { type: "string" },
    note: { type: "string" },
  },
  status: {},
} as const;

// Remove every `--<name> <artifact> <reason>` from args, and return them by
// artifact.
function takePairs(args: string[], name: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (let i = args.indexOf(`--${name}`); i >= 0; i = args.indexOf(`--${name}`)) {
    const [artifact, reason] = [args[i + 1], args[i + 2]];
    if (!artifact || !reason || artifact.startsWith("--") || !reason.trim()) {
      throw new UsageError(`--${name} takes an artifact and a reason, for example --${name} code "only the docs changed"`);
    }
    pairs[artifact] = reason.trim();
    args.splice(i, 3);
  }
  return pairs;
}

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
  const unchanged = command === "continue" ? takePairs(args, "unchanged") : {};
  const notProduced = command === "continue" ? takePairs(args, "not-produced") : {};
  if (command === "help" || command === "--help" || command === "-h") return [USAGE];
  if (command === "validate") return validate(args);
  if (!command || !Object.hasOwn(OPTIONS, command)) throw new UsageError(command ? `unknown command "${command}"` : "no command");

  const { slug, values } = parse(command as Command, args);
  const root = findRepoRoot(process.cwd());
  switch (command as Command) {
    case "start": {
      // A path is made absolute here, so the workstream still finds it when
      // a later command runs from another directory.
      const workflow = values.workflow as string | undefined;
      const resolved = workflow && isWorkflowPath(workflow) ? resolve(workflow) : workflow;
      return commands.start(root, slug, resolved, values.from as string | undefined);
    }
    case "continue": {
      const ownerApproved = Boolean(values["owner-approved"]);
      const moreRounds = values["more-rounds"] as string | undefined;
      const backTo = values["back-to"] as string | undefined;
      const forwardTo = values["forward-to"] as string | undefined;
      // The owner's decisions, and the agent's reports, are one each.
      const decisions = [
        ownerApproved && "--owner-approved",
        moreRounds !== undefined && "--more-rounds",
        backTo !== undefined && "--back-to",
        forwardTo !== undefined && "--forward-to",
      ].filter(Boolean) as string[];
      const reports = [values.blocked !== undefined && "--blocked", values.skip !== undefined && "--skip"].filter(Boolean) as string[];
      const work = [
        values.updated !== undefined && "--updated",
        Object.keys(unchanged).length > 0 && "--unchanged",
        Object.keys(notProduced).length > 0 && "--not-produced",
      ].filter(Boolean) as string[];
      const actions = [...decisions, ...reports];
      if (actions.length > 1) throw new UsageError(`${actions.join(" and ")} are different decisions; give one`);
      if (actions.length && work.length) throw new UsageError(`${work[0]} reports the agent's work; it does not go with ${actions[0]}`);
      if (values.note !== undefined && decisions.length === 0) {
        throw new UsageError("--note goes with --owner-approved, --more-rounds, --back-to or --forward-to");
      }
      if (moreRounds !== undefined && !/^[1-9][0-9]*$/.test(moreRounds)) throw new UsageError("--more-rounds takes a whole number of rounds, 1 or more");
      return commands.continueWorkstream(root, slug, {
        ownerApproved,
        note: values.note as string | undefined,
        blocked: values.blocked as string | undefined,
        skip: values.skip as string | undefined,
        moreRounds: moreRounds === undefined ? undefined : Number(moreRounds),
        backTo,
        forwardTo,
        updated: ((values.updated as string[] | undefined) ?? []).map((f) => resolve(f)),
        unchanged,
        notProduced,
      });
    }
    case "status":
      return commands.status(root, slug);
  }
}

// `validate` takes references rather than a slug. A path or a directory is
// made absolute against the current directory; a directory wins over a
// workflow name that happens to be spelled the same.
function validate(args: string[]): string[] {
  let refs: string[];
  try {
    refs = parseArgs({ args, options: {}, allowPositionals: true, strict: true }).positionals;
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  if (refs.length === 0) throw new UsageError("validate takes workflow names, files or directories, for example: validate .");
  const root = findRepoRoot(process.cwd());
  return commands.validate(root, refs.map((ref) => (isWorkflowPath(ref) || isDirectory(ref) ? resolve(ref) : ref)));
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
      console.log(`REFUSED: ${e.message}`);
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
