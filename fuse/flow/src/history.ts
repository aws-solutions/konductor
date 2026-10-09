// SPDX-License-Identifier: Apache-2.0
// The events in a step's history: the texts fuse-flow writes, and reading
// them back into structured events for Komposer's run view. Writer and reader
// live together so a change of wording changes both. No file access, so the
// browser can use it too.

import type { StepStatus, Workstream } from "./schemas/workstream.ts";

const withNote = (note?: string) => (note ? `: ${note}` : "");

// The event texts. commands.ts writes each history line through these.
export const EVENT = {
  handedOut: (detail?: string) => (detail ? `handed out; ${detail}` : "handed out"),
  refused: (reason: string) => `continue refused: ${reason}`,
  awaitingOwner: () => "work recorded; awaiting the owner's action",
  completed: () => "completed",
  blocked: (reason: string) => `blocked by the agent: ${reason}`,
  // A skip the agent or the engine decided: a script, check or agent
  // condition that said no.
  skipped: (reason: string) => `skipped: ${reason}`,
  // A skip the owner decided: --skip on a step without a condition, or on
  // one whose owner-action condition the owner answered no.
  skippedOnRequest: (reason: string) => `skipped on the owner's request: ${reason}`,
  roundsGranted: (n: number, note?: string) => `owner granted ${n} more review round${n === 1 ? "" : "s"}${withNote(note)}`,
  sentBack: (from: string, to: string, note?: string) => `owner sent the work back from ${from} to ${to}${withNote(note)}`,
  approved: (note?: string) => `owner approved${withNote(note)}`,
};

// The skip reasons the owner's own commands give. They are written as
// `skipped: <reason>`, and the reason is also the step's skip_reason.
export const SKIP_REASON = {
  startedAt: (step: string) => `started at ${step}`,
  jumpedForward: (target: string, note?: string) => `owner jumped forward to ${target}${withNote(note)}`,
};

export function stamp(event: string, now = new Date()): string {
  return `${now.toISOString()} ${event}`;
}

export type EventKind =
  | "handed-out"
  | "refused"
  | "awaiting-owner"
  | "completed"
  | "blocked"
  | "skipped"
  | "rounds-granted"
  | "sent-back"
  | "approved"
  | "other";

export interface RunEvent {
  // ISO timestamp; empty when the line has none.
  time: string;
  step: string;
  kind: EventKind;
  from: StepStatus;
  to: StepStatus;
  // Absent for a line fuse-flow no longer writes.
  actor?: "agent" | "owner";
  detail: string;
  // For sent-back events: the step the owner sent the work back from, and the
  // step it went to.
  backFrom?: string;
  backTo?: string;
}

interface Reading {
  kind: EventKind;
  to?: StepStatus; // undefined: the state does not change
  actor?: "agent" | "owner";
  detail: string;
  backFrom?: string;
  backTo?: string;
}

const PATTERNS: [RegExp, (m: RegExpMatchArray) => Reading][] = [
  [/^handed out(?:; ([\s\S]*))?$/, (m) => ({ kind: "handed-out", to: "IN_PROGRESS", actor: "agent", detail: m[1] ?? "" })],
  [/^continue refused: ([\s\S]*)$/, (m) => ({ kind: "refused", actor: "agent", detail: m[1] })],
  [/^work recorded; awaiting the owner's action$/, () => ({ kind: "awaiting-owner", to: "AWAITING_OWNER", actor: "agent", detail: "" })],
  [/^completed$/, () => ({ kind: "completed", to: "COMPLETED", actor: "agent", detail: "" })],
  [/^blocked by the agent: ([\s\S]*)$/, (m) => ({ kind: "blocked", to: "BLOCKED", actor: "agent", detail: m[1] })],
  [/^skipped on the owner's request: ([\s\S]*)$/, (m) => ({ kind: "skipped", to: "SKIPPED", actor: "owner", detail: m[1] })],
  [
    /^skipped: ((?:started at |owner jumped forward to )[\s\S]*)$/,
    (m) => ({ kind: "skipped", to: "SKIPPED", actor: "owner", detail: m[1] }),
  ],
  [/^skipped: ([\s\S]*)$/, (m) => ({ kind: "skipped", to: "SKIPPED", actor: "agent", detail: m[1] })],
  [
    /^owner granted \d+ more review rounds?(?:: [\s\S]*)?$/,
    (m) => ({ kind: "rounds-granted", to: "IN_PROGRESS", actor: "owner", detail: m[0].replace(/^owner /, "") }),
  ],
  [
    /^owner sent the work back from (\S+) to (\S+?)(?:: ([\s\S]*))?$/,
    (m) => ({ kind: "sent-back", to: "PENDING", actor: "owner", detail: m[3] ?? "", backFrom: m[1], backTo: m[2] }),
  ],
  [/^owner approved(?:: ([\s\S]*))?$/, (m) => ({ kind: "approved", to: "COMPLETED", actor: "owner", detail: m[1] ?? "" })],
];

function read(text: string): Reading {
  for (const [pattern, reading] of PATTERNS) {
    const m = text.match(pattern);
    if (m) return reading(m);
  }
  return { kind: "other", detail: text };
}

const TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) ([\s\S]*)$/;

// Every event of the workstream, oldest first. Each step's events are
// replayed from PENDING, so each event knows the state it left.
export function runEvents(ws: Workstream): RunEvent[] {
  const events: RunEvent[] = [];
  for (const [step, state] of Object.entries(ws.steps)) {
    let status: StepStatus = "PENDING";
    for (const line of state.history) {
      const m = line.match(TIME);
      const r = read(m ? m[2] : line);
      const to: StepStatus = r.to ?? status;
      events.push({
        time: m ? m[1] : "",
        step,
        kind: r.kind,
        from: status,
        to,
        ...(r.actor ? { actor: r.actor } : {}),
        detail: r.detail,
        ...(r.backFrom ? { backFrom: r.backFrom, backTo: r.backTo } : {}),
      });
      status = to;
    }
  }
  // A stable sort, so a step's events stay in their written order.
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

export interface StepSummary {
  status: StepStatus;
  activeMs: number; // time spent IN_PROGRESS
  ownerWaitMs: number; // time spent AWAITING_OWNER or BLOCKED; only the owner moves a step on from either
  visits: number; // times the step was handed out
  skipReason?: string;
}

export interface RunSummary {
  // The run's state: COMPLETED when every step of the workflow is finished,
  // otherwise the state of its current step.
  status: StepStatus;
  currentStep?: string;
  started?: string;
  lastEvent?: string;
  ownerWaitMs: number;
  // Each time the owner sent the work back, once.
  routesBack: { time: string; from: string; to: string }[];
  steps: Record<string, StepSummary>;
}

// `stepIds` is the workflow's step order; `now` closes the interval of a step
// that is still in a timed state.
export function summarizeRun(ws: Workstream, stepIds: string[], now = new Date()): RunSummary {
  const events = runEvents(ws);
  const steps: Record<string, StepSummary> = {};
  for (const id of new Set([...stepIds, ...Object.keys(ws.steps)])) {
    const state = ws.steps[id];
    steps[id] = {
      status: state?.status ?? "PENDING",
      activeMs: 0,
      ownerWaitMs: 0,
      visits: 0,
      ...(state?.skip_reason ? { skipReason: state.skip_reason } : {}),
    };
  }
  const ms = (t: string) => Date.parse(t);
  const since: Record<string, { status: StepStatus; time: string }> = {};
  const add = (step: string, status: StepStatus, from: string, to: string) => {
    const span = Math.max(0, ms(to) - ms(from));
    if (Number.isNaN(span)) return;
    if (status === "IN_PROGRESS") steps[step].activeMs += span;
    if (status === "AWAITING_OWNER" || status === "BLOCKED") steps[step].ownerWaitMs += span;
  };
  const routes = new Map<string, { time: string; from: string; to: string }>();
  for (const e of events) {
    if (e.kind === "handed-out") steps[e.step].visits++;
    const open = since[e.step];
    if (open && e.time) add(e.step, open.status, open.time, e.time);
    if (e.time) since[e.step] = { status: e.to, time: e.time };
    if (e.kind === "sent-back" && e.backFrom && e.backTo) {
      routes.set(`${e.time} ${e.backFrom} ${e.backTo}`, { time: e.time, from: e.backFrom, to: e.backTo });
    }
  }
  for (const [step, open] of Object.entries(since)) add(step, open.status, open.time, now.toISOString());
  const finished = (s: StepStatus) => s === "COMPLETED" || s === "SKIPPED";
  const current = stepIds.find((id) => !finished(steps[id].status));
  const timed = events.filter((e) => e.time);
  return {
    status: current ? steps[current].status : "COMPLETED",
    ...(current ? { currentStep: current } : {}),
    ...(timed.length ? { started: timed[0].time, lastEvent: timed[timed.length - 1].time } : {}),
    ownerWaitMs: Object.values(steps).reduce((sum, s) => sum + s.ownerWaitMs, 0),
    routesBack: [...routes.values()],
    steps,
  };
}
