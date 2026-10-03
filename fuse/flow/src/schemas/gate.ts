// SPDX-License-Identifier: Apache-2.0
// The schema of a gate, what must hold before a step counts as done, and of a
// condition, which says when an optional step runs. Both are written the same
// way. `bun run schema` writes the gate schema to gate.schema.json.

import { z } from "zod";

export const GATE_KINDS = ["owner-action", "check", "script", "agent"] as const;
export type GateKind = (typeof GATE_KINDS)[number];

// `text` is what the gate says: the owner's action, the kind of check, the
// command, or what the agent reviews. max_rounds and guide are set on agent
// gates only; max_rounds is undefined when the workflow does not set it, so
// policy can fill it in (decision 37). route_back_to lists the steps to
// suggest sending the work back to.
export type Gate = { kind: GateKind; text: string; max_rounds?: number; guide?: string; route_back_to: string[] };

// A condition is a gate without the fields that only make sense on a gate.
export type Condition = { kind: GateKind; text: string };

export const STEP_ID = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase letters, digits and hyphens");
const isStepId = (v: unknown): v is string => STEP_ID.safeParse(v).success;

// A kind of check names what to run, not how: a single lower-case word that
// the project's policy binds to a command (decisions 24, 41 and 47).
export const CHECK_KIND = /^[a-z][a-z0-9]*$/;

// How many review rounds that end with a required fix an agent gate allows,
// unless the workflow or policy sets its own max_rounds. Konductor's default.
export const DEFAULT_MAX_ROUNDS = 2;

const isKind = (k: string): k is GateKind => (GATE_KINDS as readonly string[]).includes(k);

const HINT =
  'must be one of owner-action, check, script or agent, as a one-key mapping such as `owner-action: approve` ' +
  'or a string such as `script("bun run check")`';

// Why one written gate or condition is refused, or the gate it stands for.
// `asCondition` refuses the fields only a gate may carry.
function parseGate(v: unknown, asCondition: boolean): Gate | string {
  let kind: string;
  let text: unknown;
  let extra: Record<string, unknown> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const { max_rounds, guide, description, route_back_to, ...rest } = v as Record<string, unknown>;
    extra = { max_rounds, guide, description, route_back_to };
    const entries = Object.entries(rest);
    if (entries.length !== 1) return `${HINT}; got ${JSON.stringify(v)}`;
    [kind, text] = entries[0];
  } else if (typeof v === "string") {
    const s = v.trim();
    if (s === "owner") return 'the legacy gate `owner` is no longer accepted; write `owner-action: approve`';
    if (s === "none") return "the legacy gate `none` is no longer accepted; leave the gate out";
    const m = /^([a-z-]+)\s*(?:\(\s*"?(.*?)"?\s*\)|:(.*))$/s.exec(s);
    if (!m) return `${HINT}; got ${JSON.stringify(v)}`;
    kind = m[1];
    text = m[2] ?? m[3];
  } else {
    return `${HINT}; got ${JSON.stringify(v)}`;
  }

  if (!isKind(kind)) return `${HINT}; got ${JSON.stringify(v)}`;
  if (typeof text !== "string" || !text.trim()) return `${kind} needs a text; got ${JSON.stringify(v)}`;
  const trimmed = text.trim();
  if (kind === "check" && !CHECK_KIND.test(trimmed)) {
    return `check names a kind of check, a single lower-case word such as default; for a command use \`script: ${trimmed}\``;
  }
  const { max_rounds: maxRounds, guide, description, route_back_to: routeBackTo } = extra;
  if (description !== undefined && typeof description !== "string") return "description must be text";
  if (asCondition) {
    for (const field of ["max_rounds", "guide", "route_back_to"] as const) {
      if (extra[field] !== undefined) return `a condition has no ${field}`;
    }
    return { kind, text: trimmed, route_back_to: [] };
  }
  const routes = routeBackTo === undefined ? [] : Array.isArray(routeBackTo) ? routeBackTo : [routeBackTo];
  if (!routes.every(isStepId)) return `route_back_to names step ids; got ${JSON.stringify(routeBackTo)}`;
  if (maxRounds !== undefined && kind !== "agent") return "max_rounds goes on an agent gate only";
  if (maxRounds !== undefined && (!Number.isInteger(maxRounds) || (maxRounds as number) < 1)) {
    return `max_rounds must be a whole number, 1 or more; got ${JSON.stringify(maxRounds)}`;
  }
  if (guide !== undefined && kind !== "agent") return "guide goes on an agent gate only";
  if (guide !== undefined && (typeof guide !== "string" || !guide.trim())) return "guide must be a path";
  const gate: Gate = { kind, text: trimmed, route_back_to: routes };
  if (maxRounds !== undefined) gate.max_rounds = maxRounds as number;
  if (guide !== undefined) gate.guide = (guide as string).trim();
  return gate;
}

const KIND_DOCS: Record<GateKind, string> = {
  "owner-action":
    "The owner does what this text says, for example approve the design. Engine effect: the step waits for the " +
    "owner (AWAITING_OWNER) when it is continued, until `fuse-flow continue <slug> --owner-approved`.",
  check:
    "A kind of check, a single lower-case word such as `default`, which the project's policy binds to a command " +
    "(checks: { default: bun run check }). Engine effect: the bound command runs from the repository root when " +
    "the step is continued, and `continue` is refused unless it exits 0. An unbound kind refuses the step and " +
    "tells the agent to find the command and record it; a kind bound to `none` passes.",
  script:
    "A shell command, run from the repository root when the step is continued. Engine effect: `continue` is " +
    "refused unless the command exits 0.",
  agent:
    "What an independent agent reviews. The agent that did the work classifies each finding as fix required or " +
    "false positive, fixes what is required, and they repeat until a round ends with no required fix, or as the " +
    "review guide says. Engine effect: none; the text, the review guide and the round cap are printed with the " +
    "step, and the agent that did the work counts the rounds.",
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

const MAX_ROUNDS = z.number().int().min(1).optional().meta({
  description:
    `How many review rounds that end with a required fix the step allows; ${DEFAULT_MAX_ROUNDS} unless the ` +
    "workflow or policy says otherwise. When the cap is reached, the agent that did the work does not start " +
    'another round; it runs `fuse-flow continue <slug> --blocked "<why>"`. Engine effect: none; fuse-flow prints ' +
    "the cap, raised by any rounds the owner granted, and does not count the rounds.",
});

const GUIDE = z.string().optional().meta({
  description:
    "A review guide for this gate, relative to the workflow file or absolute. It replaces the review guides of " +
    "the step's artifacts and decides what counts as a required fix and when a round passes. A project's policy " +
    "or its own library can replace it. Engine effect: printed with the step.",
});

// The shapes a gate may be written in. They only decide what editors offer;
// parseGate then reads the value, so a value that matches a shape but breaks a
// rule is refused there, with the reason.
const SHAPES = [
  ...(["owner-action", "check", "script"] as const).map((kind) =>
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
      max_rounds: MAX_ROUNDS,
      guide: GUIDE,
    })
    .strict()
    .meta({ description: "The agent gate as a mapping: `agent: …`, optionally with `max_rounds`, `guide`, `description` and `route_back_to`." }),
  z.string().meta({
    description: 'As a string: `owner-action("…")`, `check: default`, `script("…")` or `agent: …`.',
    // For editors only: parseGate decides at run time.
    pattern: String.raw`^\s*(owner-action|check|script|agent)\s*[(:][\s\S]*$`,
  }),
] as const;

export const GateSchema = z
  .union(SHAPES)
  .meta({ id: "Gate", title: "fuse-flow gate", description: "What must hold before a step counts as done." });

// The shapes a condition may be written in, for editors: one gate kind, with
// no gate-only fields. ConditionSchema below does the reading.
export const ConditionShapeSchema = z
  .union([
    ...(["owner-action", "check", "script", "agent"] as const).map((kind) =>
      z
        .object({ [kind]: z.string().meta({ description: KIND_DOCS[kind] }), description: DESCRIPTION })
        .strict()
        .meta({ description: `The ${kind} condition as a mapping: \`${kind}: …\`.` }),
    ),
    z.string().meta({
      description: 'As a string: `script("…")`, `check: <kind>`, `agent: …` or `owner-action: …`.',
      pattern: String.raw`^\s*(owner-action|check|script|agent)\s*[(:][\s\S]*$`,
    }),
  ])
  .meta({ id: "Condition", title: "fuse-flow condition", description: "When an optional step runs." });

// One gate or a list, read back as a list.
export const GateListSchema = z
  .unknown()
  .optional()
  .transform((v, ctx) => {
    const items = v === undefined ? [] : Array.isArray(v) ? v : [v];
    const gates: Gate[] = [];
    items.forEach((item, i) => {
      const gate = parseGate(item, false);
      if (typeof gate === "string") ctx.addIssue({ code: "custom", path: Array.isArray(v) ? [i] : [], message: gate });
      else gates.push(gate);
    });
    return gates;
  })
  .meta({ description: "One gate or a list.", anyOf: [{ $ref: "./gate.schema.json" }, { type: "array", items: { $ref: "./gate.schema.json" } }] });

// A step's condition: when it runs. One gate kind, with no gate-only fields.
export const ConditionSchema = z
  .unknown()
  .optional()
  .transform((v, ctx): Condition | undefined => {
    if (v === undefined) return undefined;
    const parsed = parseGate(v, true);
    if (typeof parsed === "string") {
      ctx.addIssue({ code: "custom", message: parsed });
      return undefined;
    }
    return { kind: parsed.kind, text: parsed.text };
  })
  .meta({
    description:
      "When the step runs, written like one gate: `script: <command>` or `check: <kind>` (run when the step is " +
      "reached; exit 0 runs the step, anything else skips it), `agent: <when to do the step>` (the agent judges), " +
      "or `owner-action: <the question>` (the agent asks the owner). Engine effect: a step without a condition is " +
      "mandatory; one with a condition may be skipped with `continue <slug> --skip \"<reason>\"`.",
    $ref: "./condition.schema.json",
  });
