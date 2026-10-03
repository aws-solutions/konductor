// SPDX-License-Identifier: Apache-2.0
// The schema of a gate: what must hold before a step counts as done, besides
// its artifacts existing. `bun run schema` writes it to gate.schema.json.

import { z } from "zod";

export const GATE_KINDS = ["owner-action", "script", "agent"] as const;
export type GateKind = (typeof GATE_KINDS)[number];
// `text` is what the gate says: the owner's action, the command, or what the
// agent reviews. max_rounds is set on agent gates only. route_back_to lists
// the steps to suggest sending the work back to when the step is blocked.
export type Gate = { kind: GateKind; text: string; max_rounds?: number; route_back_to: string[] };

export const STEP_ID = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase letters, digits and hyphens");
const isStepId = (v: unknown): v is string => STEP_ID.safeParse(v).success;

// How many review rounds that end with findings an agent gate allows, unless
// it sets its own max_rounds. Konductor's default for its review loops.
export const DEFAULT_MAX_ROUNDS = 2;

const withRounds = (gate: Gate, maxRounds?: number): Gate =>
  gate.kind === "agent" ? { ...gate, max_rounds: maxRounds ?? DEFAULT_MAX_ROUNDS } : gate;

const isKind = (k: string): k is GateKind => (GATE_KINDS as readonly string[]).includes(k);

// Accepts `{ script: "bun run check" }`, `script("bun run check")` or
// `script: bun run check`, plus the older `owner`, `none` and `check: <command>`.
// A gate written as a mapping may add a free-text `description`, which fuse-flow
// ignores, and `route_back_to`; an agent gate may add `max_rounds`.
// Returns null for `none` and undefined for anything it does not accept.
function parseGate(v: unknown): Gate | null | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const { max_rounds: maxRounds, description, route_back_to: routeBackTo, ...rest } = v as Record<string, unknown>;
    const entries = Object.entries(rest);
    if (entries.length !== 1 || (description !== undefined && typeof description !== "string")) return undefined;
    const routes = routeBackTo === undefined ? [] : Array.isArray(routeBackTo) ? routeBackTo : [routeBackTo];
    if (!routes.every(isStepId)) return undefined;
    const [kind, text] = entries[0];
    if (!isKind(kind) || typeof text !== "string" || !text.trim()) return undefined;
    if (maxRounds !== undefined && (kind !== "agent" || !Number.isInteger(maxRounds) || (maxRounds as number) < 1)) {
      return undefined;
    }
    return withRounds({ kind, text: text.trim(), route_back_to: routes }, maxRounds as number | undefined);
  }
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s === "none") return null;
  if (s === "owner") return { kind: "owner-action", text: "approve", route_back_to: [] };
  const m = /^([a-z-]+)\s*(?:\(\s*"?(.*?)"?\s*\)|:(.*))$/s.exec(s);
  if (!m) return undefined;
  const kind = m[1] === "check" ? "script" : m[1];
  const text = (m[2] ?? m[3] ?? "").trim();
  return isKind(kind) && text ? withRounds({ kind, text, route_back_to: [] }) : undefined;
}

const GATE_HINT =
  'must be owner-action("…"), script("…") or agent("…"), as a string or a one-key mapping ' +
  "(a mapping may add description and route_back_to, and an agent mapping max_rounds: <n>)";
const refusal = (item: unknown) => `${GATE_HINT}, got ${JSON.stringify(item)}`;

const KIND_DOCS: Record<GateKind, string> = {
  "owner-action":
    "The owner does what this text says, then runs `fuse-flow continue <slug> --owner-approved`. " +
    "Engine effect: a step with an owner-action gate goes to awaiting-owner instead of done when it is continued.",
  script:
    "A shell command, run from the repository root when the step is continued. " +
    "Engine effect: `continue` is refused unless the command exits 0.",
  agent:
    "An agent reviews the work as this text says. The agent that did the work classifies each finding as " +
    "fix required or false positive, fixes what is required, and they repeat until a round ends with no " +
    "required fix. Engine effect: none; the text and the round " +
    "cap are printed with the step, and the agent that did the work counts the rounds.",
};

const DESCRIPTION = z.string().optional().meta({
  description: "What the gate is for, in free text, for the reader. Engine effect: none.",
});

const ROUTE_BACK_TO = z
  .union([STEP_ID, z.array(STEP_ID)])
  .optional()
  .meta({
    description:
      "The steps the work should go back to when this gate cannot be passed: one step id or a list, each " +
      "this step or one before it. Usually the step that produces the artifact the gate finds fault with. " +
      "Engine effect: when the step awaits the owner or is blocked, fuse-flow suggests these steps for " +
      "`--back-to`, and the viewer draws them as routes back.",
    examples: ["design", ["design", "spec"]],
  });

// The shape of one gate as it is written. It only decides which values are
// worth parsing; parseGate then reads them, so a string that matches the
// shape but not a gate kind is refused there.
export const GateSchema = z
  .union([
    ...(["owner-action", "script"] as const).map((kind) =>
      z
        .object({ [kind]: z.string().meta({ description: KIND_DOCS[kind] }), description: DESCRIPTION, route_back_to: ROUTE_BACK_TO })
        .strict()
        .meta({ description: `The ${kind} gate as a mapping: \`${kind}: …\`, optionally with \`description\` and \`route_back_to\`.` }),
    ),
    z
      .object({
        agent: z.string().meta({ description: KIND_DOCS.agent }),
        description: DESCRIPTION,
        route_back_to: ROUTE_BACK_TO,
        max_rounds: z.number().int().min(1).default(DEFAULT_MAX_ROUNDS).meta({
          description:
            "How many review rounds that end with a required fix the step allows, whatever the cause: the maker and the " +
            "reviewer disagree, the reviewer finds new problems each round, or a fix introduces a regression. When " +
            "the cap is reached, the agent " +
            "that did the work does not start another round; it runs `fuse-flow continue <slug> --blocked " +
            '"<why>"`. The owner then accepts the step as it is, grants more rounds, or sends the work back to ' +
            "an earlier step. Engine effect: none; fuse-flow prints the cap, raised by any rounds the owner " +
            "granted, and does not count the rounds.",
        }),
      })
      .strict()
      .meta({ description: "The agent gate as a mapping: `agent: …`, optionally with `max_rounds`, `description` and `route_back_to`." }),
    z.string().meta({
      description:
        'A gate as a string: `owner-action("…")`, `script("…")` or `agent("…")`. Also accepted, from the ' +
        "first version of the format: `owner` (an owner-action gate that says approve), `none` (no gate) and " +
        "`check: <command>` (a script gate).",
      // For editors only: parseGate decides at run time.
      pattern: String.raw`^\s*(none|owner|(owner-action|script|agent|check)\s*[(:][\s\S]*)$`,
    }),
  ])
  .meta({ id: "Gate", title: "fuse-flow gate", description: "What must hold before a step counts as done." });

// One gate or a list of gates, read back as a list without the `none` gates.
export const GateListSchema = z
  .union([GateSchema, z.array(GateSchema)], {
    // The union only says that no shape matched; name every value that did not.
    error: (issue) => {
      const items = Array.isArray(issue.input) ? issue.input : [issue.input];
      const bad = items.filter((item) => parseGate(item) === undefined);
      return `${GATE_HINT}, got ${(bad.length ? bad : [issue.input]).map((item) => JSON.stringify(item)).join(", ")}`;
    },
  })
  .optional()
  .transform((v, ctx) => {
    const items = v === undefined ? [] : Array.isArray(v) ? v : [v];
    const gates: Gate[] = [];
    for (const item of items) {
      const gate = parseGate(item);
      if (gate === undefined) ctx.addIssue({ code: "custom", message: refusal(item) });
      else if (gate) gates.push(gate);
    }
    return gates;
  });
