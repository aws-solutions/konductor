// SPDX-License-Identifier: Apache-2.0
// End-to-end tests of Komposer's server: each test starts the real server on a
// throwaway project, produces state with the real fuse-flow command line where
// it needs some, and checks the API's answers. Nothing of our own is mocked.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type KomposerServer, startServer } from "../app.ts";

const CLI = resolve(import.meta.dir, "..", "..", "..", "flow", "src", "cli.ts");
const PACKAGE_WORKFLOWS = realpathSync(resolve(import.meta.dir, "..", "..", "..", "flow", "workflows"));
const TOKEN = "test-token";

const TWO_STEPS = `version: 1
name: two steps
steps:
  - id: draft
    title: Draft
    # a comment that must survive
    instruction: >
      Write the draft.
    gates:
      - owner-action: approve the draft
  - id: polish
    instruction: Polish it.
    consumes: [notes]
    gates:
      - owner-action: approve the polish
        route_back_to: draft
`;

let root: string;
let home: string;
let server: KomposerServer;
let savedHome: string | undefined;

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function write(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function flow(...args: string[]): string {
  const proc = Bun.spawnSync([process.execPath, "run", CLI, ...args], {
    cwd: root,
    env: { ...(process.env as Record<string, string>), HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = proc.stdout.toString() + proc.stderr.toString();
  if (proc.exitCode !== 0) throw new Error(`fuse-flow ${args.join(" ")} exited ${proc.exitCode}\n${out}`);
  return out;
}

async function api(path: string, init: RequestInit = {}, token: string | null = TOKEN): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${server.url}${path}`, { ...init, headers });
}

async function json(path: string, init: RequestInit = {}): Promise<any> {
  const res = await api(path, init);
  expect(res.status).toBe(200);
  return res.json();
}

// A raw request with a chosen Host header, which fetch does not let us set.
function withHost(host: string, path: string): Promise<number> {
  const url = new URL(server.url);
  return new Promise((done, fail) => {
    const req = request(
      { host: "127.0.0.1", port: url.port, path, headers: { host, authorization: `Bearer ${TOKEN}` } },
      (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      },
    );
    req.on("error", fail);
    req.end();
  });
}

beforeEach(() => {
  const base = process.env.KIROCREW_SCRATCH ?? tmpdir();
  root = realpathSync(mkdtempSync(join(base, "komposer-test-")));
  mkdirSync(join(root, ".git"));
  home = join(root, "home");
  mkdirSync(home);
  savedHome = process.env.HOME;
  process.env.HOME = home;
  server = startServer({ root, port: 0, token: TOKEN });
});

afterEach(() => {
  server.stop();
  process.env.HOME = savedHome;
  rmSync(root, { recursive: true, force: true });
});

describe("access", () => {
  test("refuses a request without the token", async () => {
    expect((await api("/api/session", {}, null)).status).toBe(401);
    expect((await api("/api/session", {}, "wrong")).status).toBe(401);
  });

  test("refuses a foreign Host header, which DNS rebinding would send", async () => {
    const port = new URL(server.url).port;
    expect(await withHost(`127.0.0.1:${port}`, "/api/session")).toBe(200);
    expect(await withHost(`localhost:${port}`, "/api/session")).toBe(200);
    expect(await withHost(`evil.example:${port}`, "/api/session")).toBe(403);
  });

  test("listens on 127.0.0.1 only", () => {
    expect(new URL(server.url).hostname).toBe("127.0.0.1");
  });

  test("names the project and the three workflow locations", async () => {
    const session = await json("/api/session");
    expect(session.root).toBe(root);
    expect(session.locations.map((l: any) => l.id)).toEqual(["project", "personal", "fuse-flow"]);
    expect(session.locations[0].path).toBe(join(root, ".konductor", "workflows"));
    expect(session.locations[1].path).toBe(join(home, ".konductor", "workflows"));
    expect(session.locations[2].path).toBe(PACKAGE_WORKFLOWS);
  });
});

describe("workflows", () => {
  test("lists the workflows of all three locations with their text and hash", async () => {
    write(join(root, ".konductor", "workflows", "two-steps.yml"), TWO_STEPS);
    write(join(home, ".konductor", "workflows", "docs", "mine.yml"), TWO_STEPS);
    const { workflows } = await json("/api/workflows");
    const project = workflows.find((w: any) => w.location === "project");
    expect(project).toMatchObject({ dir: "", file: "two-steps.yml", text: TWO_STEPS, hash: hash(TWO_STEPS) });
    expect(project.path).toBe(join(root, ".konductor", "workflows", "two-steps.yml"));
    expect(workflows.find((w: any) => w.location === "personal")).toMatchObject({ dir: "docs", file: "mine.yml" });
    const shipped = workflows.find((w: any) => w.location === "fuse-flow" && w.file === "superpowers.yml");
    expect(shipped).toMatchObject({ dir: "examples/superpowers" });
  });

  test("updates the original when its hash is still the base hash", async () => {
    const path = write(join(root, ".konductor", "workflows", "two-steps.yml"), TWO_STEPS);
    const text = TWO_STEPS.replace("title: Draft", "title: First draft");
    const res = await json("/api/workflows", { method: "PUT", body: JSON.stringify({ path, baseHash: hash(TWO_STEPS), text }) });
    expect(res.hash).toBe(hash(text));
    expect(readFileSync(path, "utf8")).toBe(text);
  });

  test("refuses to update a file that changed on disk since the base hash", async () => {
    const path = write(join(root, ".konductor", "workflows", "two-steps.yml"), TWO_STEPS);
    writeFileSync(path, `${TWO_STEPS}# edited elsewhere\n`);
    const res = await api("/api/workflows", { method: "PUT", body: JSON.stringify({ path, baseHash: hash(TWO_STEPS), text: "x" }) });
    expect(res.status).toBe(409);
    expect(readFileSync(path, "utf8")).toBe(`${TWO_STEPS}# edited elsewhere\n`);
  });

  test("refuses to write outside the workflow locations or a file that is not .yml", async () => {
    write(join(root, "elsewhere.yml"), TWO_STEPS);
    for (const path of [join(root, "elsewhere.yml"), join(root, ".konductor", "workflows", "..", "..", "elsewhere.yml"), join(root, ".konductor", "workflows", "notes.txt")]) {
      const res = await api("/api/workflows", { method: "PUT", body: JSON.stringify({ path, baseHash: hash(TWO_STEPS), text: "x" }) });
      expect(res.status).toBe(403);
    }
    expect(readFileSync(join(root, "elsewhere.yml"), "utf8")).toBe(TWO_STEPS);
    expect(existsSync(join(root, ".konductor", "workflows", "notes.txt"))).toBe(false);
  });

  test("saves a new file, and refuses an existing name or one that breaks the naming rule", async () => {
    const body = { location: "project", folder: "team/flows", file: "new-flow", text: TWO_STEPS };
    const created = await json("/api/workflows", { method: "POST", body: JSON.stringify(body) });
    const path = join(root, ".konductor", "workflows", "team", "flows", "new-flow.yml");
    expect(created).toMatchObject({ path, hash: hash(TWO_STEPS) });
    expect(readFileSync(path, "utf8")).toBe(TWO_STEPS);
    expect((await api("/api/workflows", { method: "POST", body: JSON.stringify(body) })).status).toBe(409);
    for (const bad of [{ file: "New Flow" }, { folder: "../out" }, { location: "nowhere" }]) {
      const res = await api("/api/workflows", { method: "POST", body: JSON.stringify({ ...body, file: "other", ...bad }) });
      expect(res.status).toBe(400);
    }
  });

  test("keeps a working copy next to the project, ignored by git, until it is removed", async () => {
    const path = write(join(home, ".konductor", "workflows", "mine.yml"), TWO_STEPS);
    const text = `${TWO_STEPS}# unsaved\n`;
    await json("/api/working-copies", { method: "PUT", body: JSON.stringify({ path, text }) });
    const copy = join(root, ".konductor", "editor", "personal", "mine.yml");
    expect(readFileSync(copy, "utf8")).toBe(text);
    expect(readFileSync(join(root, ".konductor", "editor", ".gitignore"), "utf8")).toBe("*\n");
    const listed = (await json("/api/workflows")).workflows.find((w: any) => w.path === path);
    expect(listed.workingCopy).toBe(text);
    expect(readFileSync(path, "utf8")).toBe(TWO_STEPS);
    await json("/api/working-copies", { method: "DELETE", body: JSON.stringify({ path }) });
    expect(existsSync(copy)).toBe(false);
    expect((await json("/api/workflows")).workflows.find((w: any) => w.path === path).workingCopy).toBeUndefined();
  });

  test("tells a watcher when the open file changes on disk", async () => {
    const path = write(join(root, ".konductor", "workflows", "two-steps.yml"), TWO_STEPS);
    const res = await fetch(`${server.url}/api/watch?path=${encodeURIComponent(path)}&token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const changed = `${TWO_STEPS}# changed\n`;
    setTimeout(() => writeFileSync(path, changed), 100);
    let seen = "";
    const deadline = Date.now() + 5000;
    while (!seen.includes(hash(changed)) && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
    }
    await reader.cancel();
    expect(seen).toContain(`"hash":"${hash(changed)}"`);
  });
});

describe("library", () => {
  test("lists every entry at each level, with its files and which entry wins", async () => {
    write(join(root, ".konductor", "library", "artifacts", "design", "guide.md"), "project guide\n");
    write(join(home, ".konductor", "library", "artifacts", "design", "guide.md"), "user guide\n");
    write(join(home, ".konductor", "library", "artifacts", "design", "review.md"), "user review\n");
    write(join(home, ".konductor", "library", "artifacts", "notes", "template.md"), "# Notes\n");
    const { entries } = await json("/api/library");
    const mine = entries.filter((e: any) => e.level !== "package");
    expect(mine).toEqual([
      {
        id: "design",
        level: "project",
        folder: join(root, ".konductor", "library", "artifacts", "design"),
        files: { "guide.md": "project guide\n" },
        hides: "user",
      },
      {
        id: "design",
        level: "user",
        folder: join(home, ".konductor", "library", "artifacts", "design"),
        files: { "guide.md": "user guide\n", "review.md": "user review\n" },
        hiddenBy: "project",
      },
      { id: "notes", level: "user", folder: join(home, ".konductor", "library", "artifacts", "notes"), files: { "template.md": "# Notes\n" } },
    ]);
    // The package's design entry is hidden by the project's.
    expect(entries.find((e: any) => e.id === "design" && e.level === "package")).toMatchObject({ hiddenBy: "project" });
  });

  test("an entry's description comes from its entry.yml, which is not listed as a file", async () => {
    const folder = join(root, ".konductor", "library", "artifacts", "notes");
    write(join(folder, "entry.yml"), "# what the notes are\ndescription: >\n  The notes kept\n  while working.\n");
    write(join(folder, "guide.md"), "guide\n");
    const { entries } = await json("/api/library");
    expect(entries.find((e: any) => e.id === "notes")).toEqual({
      id: "notes",
      level: "project",
      folder,
      description: "The notes kept while working.",
      files: { "guide.md": "guide\n" },
    });
  });

  test("an entry.yml that does not match its schema is reported on the entry, not as a failed listing", async () => {
    const base = join(root, ".konductor", "library", "artifacts");
    write(join(base, "empty", "entry.yml"), "description: ''\n");
    write(join(base, "extra", "entry.yml"), "description: Fine.\ncolour: red\n");
    write(join(base, "broken", "entry.yml"), "description: [unclosed\n");
    const { entries } = await json("/api/library");
    const mine = (id: string) => entries.find((e: any) => e.id === id && e.level === "project");
    expect(mine("empty").description).toBeUndefined();
    expect(mine("empty").entryProblem).toContain("description");
    expect(mine("extra").entryProblem).toContain("colour");
    expect(mine("broken").entryProblem).toContain("not valid YAML");
  });

  test("every entry that ships with fuse-flow has a description", async () => {
    const { entries } = await json("/api/library");
    const shipped = entries.filter((e: any) => e.level === "package");
    expect(shipped.length).toBeGreaterThan(0);
    for (const entry of shipped) {
      expect({ id: entry.id, problem: entry.entryProblem }).toEqual({ id: entry.id, problem: undefined });
      expect(typeof entry.description).toBe("string");
    }
  });
});

describe("workstreams", () => {
  test("a run's events, states, times, visits and routes back, from real fuse-flow commands", async () => {
    write(join(root, ".konductor", "workflows", "two-steps.yml"), TWO_STEPS.replace("    consumes: [notes]\n", ""));
    flow("start", "demo", "--workflow", "two-steps");
    flow("continue", "demo");
    flow("continue", "demo", "--owner-approved", "--note", "good draft");
    flow("continue", "demo");
    flow("continue", "demo", "--back-to", "draft", "--note", "start over");

    const { workstreams } = await json("/api/workstreams");
    expect(workstreams).toHaveLength(1);
    const run = workstreams[0];
    expect(run.slug).toBe("demo");
    expect(run.workflowPath).toBe(join(root, ".konductor", "workflows", "two-steps.yml"));
    // Events of one command share a millisecond often enough that only each
    // step's own order is fixed; the run as a whole is ordered by time.
    const of = (step: string) => run.events.filter((e: any) => e.step === step);
    expect(of("draft").map((e: any) => [e.kind, e.from, e.to, e.actor])).toEqual([
      ["handed-out", "PENDING", "IN_PROGRESS", "agent"],
      ["awaiting-owner", "IN_PROGRESS", "AWAITING_OWNER", "agent"],
      ["approved", "AWAITING_OWNER", "COMPLETED", "owner"],
      ["sent-back", "COMPLETED", "PENDING", "owner"],
      ["handed-out", "PENDING", "IN_PROGRESS", "agent"],
    ]);
    expect(of("polish").map((e: any) => [e.kind, e.from, e.to, e.actor])).toEqual([
      ["handed-out", "PENDING", "IN_PROGRESS", "agent"],
      ["awaiting-owner", "IN_PROGRESS", "AWAITING_OWNER", "agent"],
      ["sent-back", "AWAITING_OWNER", "PENDING", "owner"],
    ]);
    const times = run.events.map((e: any) => e.time);
    expect(times).toEqual([...times].sort());
    for (const t of times) expect(Date.parse(t)).not.toBeNaN();
    expect(of("draft")[2].detail).toBe("good draft");
    const sentBack = of("draft")[3];
    expect(sentBack).toMatchObject({ backFrom: "polish", backTo: "draft", detail: "start over" });
    // One send-back writes one line, with one time, to every step it reopens.
    expect(of("polish")[2].time).toBe(sentBack.time);

    const s = run.summary;
    expect(s).toMatchObject({ status: "IN_PROGRESS", currentStep: "draft", started: run.events[0].time });
    expect(s.steps.draft).toMatchObject({ status: "IN_PROGRESS", visits: 2 });
    expect(s.steps.polish).toMatchObject({ status: "PENDING", visits: 1 });
    expect(s.steps.draft.ownerWaitMs).toBeGreaterThan(0);
    expect(s.ownerWaitMs).toBe(s.steps.draft.ownerWaitMs + s.steps.polish.ownerWaitMs);
    // Written on both reopened steps, counted once.
    expect(s.routesBack).toEqual([{ time: sentBack.time, from: "polish", to: "draft" }]);
  });

  test("skips, blocks and granted rounds, with who caused them", async () => {
    write(
      join(root, ".konductor", "workflows", "gated.yml"),
      `version: 1
name: gated
steps:
  - id: intro
    instruction: Say hello.
  - id: review
    instruction: Review it.
    gates:
      - agent: review the hello
  - id: extra
    instruction: Maybe more.
    condition:
      agent: the owner wants more
  - id: end
    instruction: Finish.
`,
    );
    flow("start", "g", "--workflow", "gated", "--from", "review");
    flow("continue", "g", "--blocked", "round cap reached");
    flow("continue", "g", "--more-rounds", "1");
    flow("continue", "g");
    flow("continue", "g", "--skip", "the owner wants no more");
    const run = (await json("/api/workstreams")).workstreams[0];
    const byStep = (step: string) =>
      run.events.filter((e: any) => e.step === step).map((e: any) => [e.kind, e.to, e.actor, e.detail]);
    expect(byStep("intro")).toEqual([["skipped", "SKIPPED", "owner", "started at review"]]);
    expect(byStep("review")).toEqual([
      ["handed-out", "IN_PROGRESS", "agent", ""],
      ["blocked", "BLOCKED", "agent", "round cap reached"],
      ["rounds-granted", "IN_PROGRESS", "owner", "granted 1 more review round"],
      ["completed", "COMPLETED", "agent", ""],
    ]);
    expect(byStep("extra")).toEqual([
      ["handed-out", "IN_PROGRESS", "agent", ""],
      ["skipped", "SKIPPED", "agent", "the owner wants no more"],
    ]);
    expect(byStep("end")).toEqual([["handed-out", "IN_PROGRESS", "agent", ""]]);
    expect(run.summary.steps.intro).toMatchObject({ status: "SKIPPED", skipReason: "started at review", visits: 0 });
    expect(run.summary.steps.review.ownerWaitMs).toBeGreaterThan(0);
  });

  test("a step skipped on its owner-action condition is the owner's skip", async () => {
    write(
      join(root, ".konductor", "workflows", "asked.yml"),
      `version: 1
name: asked
steps:
  - id: extra
    instruction: Maybe more.
    condition:
      owner-action: ask whether the owner wants more
  - id: end
    instruction: Finish.
`,
    );
    flow("start", "a", "--workflow", "asked");
    flow("continue", "a", "--skip", "the owner wants no more");
    const run = (await json("/api/workstreams")).workstreams[0];
    const skip = run.events.find((e: any) => e.step === "extra" && e.kind === "skipped");
    expect(skip).toMatchObject({ actor: "owner", to: "SKIPPED", detail: "the owner wants no more" });
  });

  test("a workstream whose workflow no longer resolves has no workflow path", async () => {
    const path = write(join(root, ".konductor", "workflows", "two-steps.yml"), TWO_STEPS.replace("    consumes: [notes]\n", ""));
    flow("start", "demo", "--workflow", "two-steps");
    rmSync(path);
    const run = (await json("/api/workstreams")).workstreams[0];
    expect(run.slug).toBe("demo");
    expect(run.workflowPath).toBeUndefined();
    expect(run.events).toHaveLength(1);
  });
});
