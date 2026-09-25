// SPDX-License-Identifier: Apache-2.0
// fuse-flow command line: start | next | done | gate | status.
// Exit codes: 0 success, 1 refused or failed, 64 usage error.

import { done, gate, next, start, status, type Context } from "./engine";
import { LockError } from "./lock";
import { formatGate } from "./schema";
import { FlowError } from "./store";

const USAGE = `usage:
  fuse-flow start <slug> [--workflow <path>]   mint or resume a workstream for this repository
  fuse-flow next <slug>                        print the one instruction for the next runnable step
  fuse-flow done <slug> <step> [--artifact <path>]...
                                               record a step's artifacts; refused unless every declared
                                               artifact exists and the step's check command exits 0
  fuse-flow gate <slug> <step> --owner-approved [--note <text>]
                                               record the owner's approval of a gated or blocked step
  fuse-flow status <slug>                      show every step's state

files: .konductor/workflow.yml (definition), .konductor/workstreams/<slug>.yml (state)
env:   FUSE_SKILLS_DIR overrides where skill paths resolve; FUSE_FLOW_LOCK_TIMEOUT_MS bounds lock waits`;

class UsageError extends Error {}

interface Parsed {
  positional: string[];
  flags: Map<string, string[]>;
}

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
      let value: string | undefined = eq >= 0 ? a.slice(eq + 1) : undefined;
      if (value === undefined && i + 1 < argv.length && !argv[i + 1].startsWith("--") && name !== "owner-approved") {
        value = argv[++i];
      }
      const list = flags.get(name) ?? [];
      list.push(value ?? "");
      flags.set(name, list);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function one(p: Parsed, name: string): string | undefined {
  const v = p.flags.get(name);
  if (!v) return undefined;
  if (v.length > 1) throw new UsageError(`--${name} given more than once`);
  return v[0];
}

function requireCount(p: Parsed, n: number, what: string): void {
  if (p.positional.length !== n) throw new UsageError(`${what}\n\n${USAGE}`);
}

export function main(argv: string[], ctx: Context, out: (s: string) => void): number {
  const [cmd, ...rest] = argv;
  const p = parseArgs(rest);
  try {
    switch (cmd) {
      case "start": {
        requireCount(p, 1, "start takes exactly one <slug>");
        const r = start(ctx, p.positional[0], one(p, "workflow"));
        out(`${r.resumed ? "resumed" : "minted"} workstream ${r.slug}`);
        out(`repository: ${r.root}`);
        out(`workflow:   ${r.workflowFile}`);
        out(`state:      ${r.workstreamFile}`);
        if (r.stepsAdded.length) out(`steps added from the workflow: ${r.stepsAdded.join(", ")}`);
        out(`next: fuse-flow next ${r.slug}`);
        return 0;
      }
      case "next": {
        requireCount(p, 1, "next takes exactly one <slug>");
        const slug = p.positional[0];
        const r = next(ctx, slug);
        switch (r.kind) {
          case "complete":
            out("workflow complete");
            return 0;
          case "run": {
            out(`step: ${r.step.id}${r.step.title ? ` (${r.step.title})` : ""}`);
            if (r.skillPath) {
              out(`read: ${r.skillPath}${r.skillExists ? "" : "   (not found; check FUSE_SKILLS_DIR)"}`);
            }
            if (r.step.instruction) out(`instruction: ${r.step.instruction.trim()}`);
            out(`produce: ${r.produces.length ? r.produces.join(", ") : "(nothing declared)"}`);
            out(`gate: ${formatGate(r.gate)}`);
            out(`then run: ${r.doneCommand}`);
            return 0;
          }
          case "awaiting-owner":
            out(`step: ${r.step.id} awaits owner approval`);
            out(`ask the owner to review: ${r.artifacts.length ? r.artifacts.join(", ") : "(no artifacts recorded)"}`);
            out(`then run: ${r.gateCommand}`);
            return 0;
          case "blocked":
            out(`step: ${r.step.id} is blocked after ${r.fixCycles} failed attempts`);
            for (const n of r.notes.slice(-3)) out(`  ${n}`);
            out(`ask the owner how to proceed; to accept the step as is, run: ${r.gateCommand}`);
            return 0;
          case "stuck":
            out("no runnable step:");
            for (const w of r.waitingOn) out(`  ${w.step} waits on ${w.on.join(", ")}`);
            out("the workflow's depends_on cannot be satisfied; fix .konductor/workflow.yml");
            return 1;
        }
        break;
      }
      case "done": {
        requireCount(p, 2, "done takes <slug> <step>");
        const artifacts = (p.flags.get("artifact") ?? []).filter((a) => a.length > 0);
        const r = done(ctx, p.positional[0], p.positional[1], artifacts);
        if (r.kind === "done") {
          out(`recorded ${r.step}: ${r.artifacts.length ? r.artifacts.join(", ") : "(no artifacts)"}`);
          out(r.status === "awaiting-owner" ? `${r.step} now awaits owner approval` : `${r.step} done`);
          out(`next: fuse-flow next ${p.positional[0]}`);
          return 0;
        }
        out(`refused: ${r.reason}`);
        if (r.fixCycles !== undefined) out(`fix cycles used on ${r.step}: ${r.fixCycles}${r.blocked ? " (step is now blocked)" : ""}`);
        return 1;
      }
      case "gate": {
        requireCount(p, 2, "gate takes <slug> <step>");
        const approved = p.flags.has("owner-approved");
        const r = gate(ctx, p.positional[0], p.positional[1], { ownerApproved: approved, note: one(p, "note") });
        if (r.kind === "approved") {
          out(`${r.step}: owner approved (was ${r.previous}); step done`);
          out(`next: fuse-flow next ${p.positional[0]}`);
          return 0;
        }
        out(`refused: ${r.reason}`);
        return 1;
      }
      case "status": {
        requireCount(p, 1, "status takes exactly one <slug>");
        const r = status(ctx, p.positional[0]);
        out(`workstream ${r.slug} (${r.workflowName}) in ${r.root}`);
        const w = Math.max(...r.rows.map((x) => x.id.length), 4);
        for (const row of r.rows) {
          const extra: string[] = [];
          if (row.fixCycles) extra.push(`fix cycles ${row.fixCycles}`);
          if (row.waitingOn.length) extra.push(`waits on ${row.waitingOn.join(", ")}`);
          if (row.artifacts.length) extra.push(row.artifacts.join(", "));
          out(`  ${row.id.padEnd(w)}  ${row.status.padEnd(14)}  gate ${formatGate(row.gate).padEnd(6)}${extra.length ? "  " + extra.join("; ") : ""}`);
        }
        out(r.complete ? "workflow complete" : `next: fuse-flow next ${r.slug}`);
        return 0;
      }
      case undefined:
      case "-h":
      case "--help":
      case "help":
        out(USAGE);
        return cmd === undefined ? 64 : 0;
      default:
        throw new UsageError(`unknown command "${cmd}"\n\n${USAGE}`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      out(`error: ${e.message}`);
      return 64;
    }
    if (e instanceof FlowError || e instanceof LockError) {
      out(`error: ${e.message}`);
      return 1;
    }
    if (e instanceof Error && /slug ".*" must be/.test(e.message)) {
      out(`error: ${e.message}`);
      return 64;
    }
    throw e;
  }
  return 0;
}

if (import.meta.main) {
  const code = main(process.argv.slice(2), { cwd: process.cwd() }, (s) => console.log(s));
  process.exit(code);
}
