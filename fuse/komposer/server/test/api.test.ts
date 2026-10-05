// SPDX-License-Identifier: Apache-2.0
// End-to-end tests of Komposer's server: each test starts the real server on a
// throwaway project, produces state with the real fuse-flow command line where
// it needs some, and checks the API's answers. Nothing of our own is mocked.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
        group: "",
        files: { "guide.md": "project guide\n" },
        hides: "user",
      },
      {
        id: "design",
        level: "user",
        folder: join(home, ".konductor", "library", "artifacts", "design"),
        group: "",
        files: { "guide.md": "user guide\n", "review.md": "user review\n" },
        hiddenBy: "project",
      },
      {
        id: "notes",
        level: "user",
        folder: join(home, ".konductor", "library", "artifacts", "notes"),
        group: "",
        files: { "template.md": "# Notes\n" },
      },
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
      group: "",
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

  test("an entry filed in folders names them as its group; a folder of folders is not an entry", async () => {
    const base = join(root, ".konductor", "library", "artifacts");
    write(join(base, "writing", "long-form", "essay", "guide.md"), "guide\n");
    write(join(base, "writing", "notes", ".keep"), "");
    const { entries } = await json("/api/library");
    const mine = entries.filter((e: any) => e.level === "project").map((e: any) => [e.id, e.group]);
    expect(mine).toEqual([
      ["essay", "writing/long-form"],
      ["notes", "writing"],
    ]);
  });

  test("a folder holding a hidden file and a folder is one entry, not a group", async () => {
    const base = join(root, ".konductor", "library", "artifacts");
    write(join(base, "essay", ".keep"), "");
    write(join(base, "essay", "examples", "example.md"), "example\n");
    const { entries } = await json("/api/library");
    expect(entries.filter((e: any) => e.level === "project").map((e: any) => [e.id, e.group])).toEqual([["essay", ""]]);
  });

  test("an id filed twice in one library is reported on both entries", async () => {
    const base = join(root, ".konductor", "library", "artifacts");
    write(join(base, "essay", "guide.md"), "guide\n");
    write(join(base, "writing", "essay", "guide.md"), "guide\n");
    const { entries } = await json("/api/library");
    const twins = entries.filter((e: any) => e.id === "essay" && e.level === "project");
    expect(twins).toHaveLength(2);
    for (const e of twins) expect(e.entryProblem).toContain("ambiguous");
  });

  test("a file that is a symlink names where it leads, relative to the repository holding it", async () => {
    write(join(root, "skills", "essay-writing", "SKILL.md"), "the skill\n");
    const folder = join(root, ".konductor", "library", "artifacts", "essay");
    mkdirSync(folder, { recursive: true });
    symlinkSync("../../../../skills/essay-writing/SKILL.md", join(folder, "guide.md"));
    write(join(folder, "review.md"), "review\n");
    const { entries } = await json("/api/library");
    const essay = entries.find((e: any) => e.id === "essay");
    expect(essay.files["guide.md"]).toBe("the skill\n");
    expect(essay.links).toEqual({ "guide.md": { path: join(root, "skills", "essay-writing", "SKILL.md"), display: "skills/essay-writing/SKILL.md" } });
    // The shipped design entry's guide is a Konductor skill.
    const design = entries.find((e: any) => e.id === "design" && e.level === "package");
    expect(design.links["guide.md"].display).toBe("skills/design-doc-guidelines/SKILL.md");
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

describe("review guides", () => {
  const FLOW = `version: 1
name: reviewed
steps:
  - id: write
    instruction: Write it.
    produces:
      - artifact: essay
        path: essay.md
      - artifact: notes
        path: notes.md
    gates:
      - check: default
      - agent: review the essay
        guide: rules/review.md
  - id: plain
    instruction: Check it.
    gates:
      - agent: look it over
`;

  test("names the review guide each agent gate uses, where it comes from, and the gate's own guide", async () => {
    const path = write(join(root, ".konductor", "workflows", "reviewed.yml"), FLOW);
    write(join(root, ".konductor", "workflows", "rules", "review.md"), "gate rules\n");
    write(join(root, ".konductor", "library", "artifacts", "essay", "review.md"), "project essay rules\n");
    write(join(root, ".konductor", "library", "artifacts", "notes", "guide.md"), "notes guide\n");
    const out = await json("/api/review-guides", { method: "POST", body: JSON.stringify({ path, text: FLOW }) });
    const gateGuide = join(root, ".konductor", "workflows", "rules", "review.md");
    const essayRules = join(root, ".konductor", "library", "artifacts", "essay", "review.md");
    expect(out.gates).toEqual([
      {
        step: 0,
        gate: 1,
        gateGuide: { path: gateGuide, display: ".konductor/workflows/rules/review.md", exists: true },
        reviews: [
          // The project's library replaces the gate's guide for essay ...
          { artifact: "essay", guide: { path: essayRules, display: ".konductor/library/artifacts/essay/review.md", source: "project library" } },
          // ... and the gate's guide applies to notes.
          { artifact: "notes", guide: { path: gateGuide, display: ".konductor/workflows/rules/review.md", source: "gate" } },
        ],
      },
      { step: 1, gate: 0, reviews: [{}] },
    ]);
    expect(out.files[gateGuide]).toBe("gate rules\n");
    expect(out.files[essayRules]).toBe("project essay rules\n");
  });

  test("an artifact with no review guide falls back to its own guide", async () => {
    const text = FLOW.replace("        guide: rules/review.md\n", "");
    const path = write(join(root, ".konductor", "workflows", "reviewed.yml"), text);
    write(join(root, ".konductor", "library", "artifacts", "notes", "guide.md"), "notes guide\n");
    const out = await json("/api/review-guides", { method: "POST", body: JSON.stringify({ path, text }) });
    const notesGuide = join(root, ".konductor", "library", "artifacts", "notes", "guide.md");
    expect(out.gates[0]).toEqual({
      step: 0,
      gate: 1,
      reviews: [{ artifact: "essay" }, { artifact: "notes", ownGuide: { path: notesGuide, display: ".konductor/library/artifacts/notes/guide.md" } }],
    });
    expect(out.files[notesGuide]).toBe("notes guide\n");
  });

  test("a gate guide that does not exist still applies, as the engine prints it, and is marked missing", async () => {
    const text = FLOW.replace("guide: rules/review.md", "guide: rules/missing.md");
    const path = write(join(root, ".konductor", "workflows", "reviewed.yml"), text);
    const out = await json("/api/review-guides", { method: "POST", body: JSON.stringify({ path, text }) });
    const missing = join(root, ".konductor", "workflows", "rules", "missing.md");
    expect(out.gates[0].gateGuide).toEqual({ path: missing, display: ".konductor/workflows/rules/missing.md", exists: false });
    expect(out.gates[0].reviews[1]).toEqual({
      artifact: "notes",
      guide: { path: missing, display: ".konductor/workflows/rules/missing.md", source: "gate" },
    });
    expect(out.files[missing]).toBeUndefined();
  });

  test("names every source of a review guide, in the engine's order", async () => {
    // design ships with a review guide, so the package library applies first.
    const text = (guide: string) => `version: 1
name: one
steps:
  - id: write
    instruction: Write it.
    produces:
      - artifact: design
        path: design.md
    gates:
      - agent: review it${guide}
`;
    const path = write(join(root, ".konductor", "workflows", "one.yml"), text(""));
    const ask = async (t: string) => {
      const out = await json("/api/review-guides", { method: "POST", body: JSON.stringify({ path, text: t }) });
      const guide = out.gates[0].reviews[0].guide;
      return { source: guide.source, path: guide.path, text: out.files[guide.path] };
    };
    const shipped = realpathSync(resolve(import.meta.dir, "..", "..", "..", "flow", "library", "artifacts", "design", "review.md"));
    expect(await ask(text(""))).toEqual({ source: "package library", path: shipped, text: readFileSync(shipped, "utf8") });

    const steps: [string, string, string][] = [
      ["user library", join(home, ".konductor", "library", "artifacts", "design", "review.md"), ""],
      ["user policy", join(home, ".konductor", "user-review.md"), ""],
      ["gate", join(root, ".konductor", "workflows", "gate-review.md"), "\n        guide: gate-review.md"],
      ["project library", join(root, ".konductor", "library", "artifacts", "design", "review.md"), "\n        guide: gate-review.md"],
      ["team policy", join(root, ".konductor", "team-review.md"), "\n        guide: gate-review.md"],
      ["local policy", join(root, ".konductor", "local-review.md"), "\n        guide: gate-review.md"],
    ];
    for (const [source, file, gateLine] of steps) {
      write(file, `${source} rules\n`);
      if (source === "user policy") write(join(home, ".konductor", "policy-overrides.yml"), "review:\n  guide: user-review.md\n");
      if (source === "team policy") write(join(root, ".konductor", "policy-overrides.yml"), "review:\n  guide: team-review.md\n");
      if (source === "local policy") {
        write(join(root, ".konductor", "policy-overrides.local.yml"), "review:\n  guide: local-review.md\n");
      }
      expect(await ask(text(gateLine))).toEqual({ source, path: file, text: `${source} rules\n` });
    }
  });

  test("a replaced library is not looked at: the winning entry's own guide applies", async () => {
    write(join(home, ".konductor", "library", "artifacts", "notes", "review.md"), "user rules\n");
    write(join(home, ".konductor", "library", "artifacts", "more", "notes", "review.md"), "user rules\n");
    const notesGuide = write(join(root, ".konductor", "library", "artifacts", "notes", "guide.md"), "notes guide\n");
    const text = FLOW.replace("        guide: rules/review.md\n", "");
    const path = write(join(root, ".konductor", "workflows", "reviewed.yml"), text);
    const out = await json("/api/review-guides", { method: "POST", body: JSON.stringify({ path, text }) });
    expect(out.gates[0].reviews[1]).toEqual({
      artifact: "notes",
      ownGuide: { path: notesGuide, display: ".konductor/library/artifacts/notes/guide.md" },
    });
  });

  test("lists the artifacts a step produces, may produce and updates", async () => {
    const text = `version: 1
name: modes
steps:
  - id: first
    instruction: Start.
    produces:
      - artifact: code
        path: src/
  - id: second
    instruction: Write.
    produces:
      - artifact: essay
        path: essay.md
    optional_produces:
      - artifact: notes
        path: notes.md
    updates:
      - artifact: code
        path: src/
    gates:
      - agent: review them
`;
    const path = write(join(root, ".konductor", "workflows", "modes.yml"), text);
    const out = await json("/api/review-guides", { method: "POST", body: JSON.stringify({ path, text }) });
    expect(out.gates.map((g: any) => [g.step, g.gate, g.reviews.map((r: any) => r.artifact)])).toEqual([
      [1, 0, ["essay", "notes", "code"]],
    ]);
    // The shipped code entry has a review guide.
    expect(out.gates[0].reviews[2].guide.source).toBe("package library");
  });

  test("uses the text sent, not the file on disk, and refuses a path outside the workflow locations", async () => {
    const path = write(join(root, ".konductor", "workflows", "reviewed.yml"), "version: 1\nname: x\nsteps: []\n");
    const out = await json("/api/review-guides", { method: "POST", body: JSON.stringify({ path, text: FLOW }) });
    expect(out.gates.map((g: any) => [g.step, g.gate])).toEqual([[0, 1], [1, 0]]);
    const res = await api("/api/review-guides", { method: "POST", body: JSON.stringify({ path: join(root, "x.yml"), text: FLOW }) });
    expect(res.status).toBe(403);
  });
});
