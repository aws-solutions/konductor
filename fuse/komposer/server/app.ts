// SPDX-License-Identifier: Apache-2.0
// Komposer's local server: the JSON API the app uses to read and write the
// workflow files, the library and the workstreams of one project, and the
// built app itself. Every location rule comes from fuse-flow's own code.
//
// The server writes files, so it guards itself (decision 5 of the build
// spec): it listens on 127.0.0.1 only, wants the token it was started with on
// every API request, refuses a foreign Host header (DNS rebinding), and writes
// only .yml files inside the three workflow locations and its own
// working-copy folder.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { summarizeRun, runEvents } from "../../flow/src/history.ts";
import { parseWorkflowText } from "../../flow/src/parse.ts";
import { display, libraryEntry, listLibrary, loadProject, reviewGuideSource } from "../../flow/src/policy.ts";
import { findRepoRoot, workflowDirs, workflowFilesBelow } from "../../flow/src/project.ts";
import { listWorkstreams } from "../../flow/src/workstream.ts";

export interface ServerOptions {
  root: string;
  port: number;
  token: string;
  // The built app (dist/); not served when absent.
  appDir?: string;
}

export interface KomposerServer {
  url: string;
  stop(): void;
}

type LocationId = "project" | "personal" | "fuse-flow";

interface Location {
  id: LocationId;
  label: string;
  path: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const FILE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const FOLDER_NAME = /^[a-z0-9][a-z0-9._-]*$/;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export function startServer(options: ServerOptions): KomposerServer {
  const { root, token } = options;
  const [project, personal, pkg] = workflowDirs(root);
  const locations: Location[] = [
    { id: "project", label: "Project", path: project },
    { id: "personal", label: "Personal", path: personal },
    { id: "fuse-flow", label: "fuse-flow", path: resolve(pkg) },
  ];
  const editorDir = join(root, ".konductor", "editor");

  // The location a path is in, by its resolved form, and only for .yml files.
  const locate = (path: unknown): { location: Location; path: string; rel: string } => {
    if (typeof path !== "string" || !path) throw new HttpError(400, "path is required");
    const full = resolve(path);
    if (extname(full) !== ".yml") throw new HttpError(403, `${full} is not a .yml file`);
    for (const location of locations) {
      if (full.startsWith(location.path + sep)) return { location, path: full, rel: relative(location.path, full) };
    }
    throw new HttpError(403, `${full} is not inside a workflow location`);
  };

  const workingCopyPath = (location: Location, rel: string) => join(editorDir, location.id, rel);

  const listWorkflows = () => {
    const out: Record<string, unknown>[] = [];
    for (const location of locations) {
      const seen = new Set<string>();
      const files = existsSync(location.path) ? workflowFilesBelow(root, location.path).filter((p) => p.endsWith(".yml")) : [];
      for (const path of files) {
        const rel = relative(location.path, path);
        seen.add(rel);
        const text = readFileSync(path, "utf8");
        const copy = workingCopyPath(location, rel);
        out.push({
          location: location.id,
          dir: dirname(rel) === "." ? "" : dirname(rel),
          file: basename(rel),
          path,
          onDisk: true,
          text,
          hash: sha(text),
          ...(existsSync(copy) ? { workingCopy: readFileSync(copy, "utf8") } : {}),
        });
      }
      // Working copies of new workflows that were never saved.
      const copies = join(editorDir, location.id);
      if (!existsSync(copies)) continue;
      for (const copy of workflowFilesBelow(root, copies)) {
        const rel = relative(copies, copy);
        if (seen.has(rel) || !rel.endsWith(".yml")) continue;
        out.push({
          location: location.id,
          dir: dirname(rel) === "." ? "" : dirname(rel),
          file: basename(rel),
          path: join(location.path, rel),
          onDisk: false,
          text: "",
          hash: sha(""),
          workingCopy: readFileSync(copy, "utf8"),
        });
      }
    }
    return out;
  };

  const updateOriginal = (body: any) => {
    const { path } = locate(body.path);
    if (typeof body.text !== "string") throw new HttpError(400, "text is required");
    if (!existsSync(path)) throw new HttpError(404, `${path} does not exist; save it as a new file`);
    const current = readFileSync(path, "utf8");
    if (sha(current) !== body.baseHash) throw new HttpError(409, `${path} changed on disk`);
    writeFileSync(path, body.text);
    return { path, hash: sha(body.text) };
  };

  const saveNew = (body: any) => {
    const location = locations.find((l) => l.id === body.location);
    if (!location) throw new HttpError(400, `unknown location ${JSON.stringify(body.location)}`);
    const folder = typeof body.folder === "string" ? body.folder.replace(/^\/+|\/+$/g, "") : "";
    if (folder && !folder.split("/").every((part: string) => FOLDER_NAME.test(part) && part !== "..")) {
      throw new HttpError(400, "Folder names are lower-case letters, digits, dots, hyphens and underscores.");
    }
    if (typeof body.file !== "string" || !FILE_NAME.test(body.file)) {
      throw new HttpError(400, "Lower-case letters, digits and hyphens.");
    }
    if (typeof body.text !== "string") throw new HttpError(400, "text is required");
    const { path } = locate(join(location.path, folder, `${body.file}.yml`));
    if (existsSync(path)) throw new HttpError(409, "A workflow with this file name exists there.");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body.text, { flag: "wx" });
    return { path, hash: sha(body.text) };
  };

  const putWorkingCopy = (body: any) => {
    const { location, rel } = locate(body.path);
    if (typeof body.text !== "string") throw new HttpError(400, "text is required");
    mkdirSync(editorDir, { recursive: true });
    const ignore = join(editorDir, ".gitignore");
    if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
    const copy = workingCopyPath(location, rel);
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, body.text);
    return { path: copy };
  };

  const deleteWorkingCopy = (body: any) => {
    const { location, rel } = locate(body.path);
    rmSync(workingCopyPath(location, rel), { force: true });
    return {};
  };

  // Where a file that is a symlink leads, shown relative to the repository
  // that holds it, so a guide that is a Konductor skill reads as
  // skills/<name>/SKILL.md.
  const linkTarget = (path: string): { path: string; display: string } | undefined => {
    try {
      if (!lstatSync(path).isSymbolicLink() || !existsSync(path)) return undefined;
    } catch {
      return undefined;
    }
    const real = realpathSync(path);
    return { path: real, display: relative(findRepoRoot(dirname(real)), real) };
  };

  const library = () => ({
    entries: listLibrary(root).map((e) => {
      const files: Record<string, string> = {};
      if (e.guide) files["guide.md"] = readFileSync(e.guide, "utf8");
      if (e.template && e.templateFile) files[e.templateFile] = readFileSync(e.template, "utf8");
      if (e.review) files["review.md"] = readFileSync(e.review, "utf8");
      const links = Object.fromEntries(
        Object.keys(files).flatMap((name) => {
          const target = linkTarget(join(e.folder, name));
          return target ? [[name, target]] : [];
        }),
      );
      return {
        id: e.id,
        level: e.level,
        folder: e.folder,
        group: e.group,
        ...(Object.keys(links).length ? { links } : {}),
        ...(e.description ? { description: e.description } : {}),
        ...(e.entryProblem ? { entryProblem: e.entryProblem } : {}),
        files,
        ...(e.guideMissing ? { guideMissing: e.guideMissing } : {}),
        ...(e.hides ? { hides: e.hides } : {}),
        ...(e.hiddenBy ? { hiddenBy: e.hiddenBy } : {}),
      };
    }),
  });

  // The review guide each agent gate of the sent text uses for each artifact
  // of its step, with the layer it comes from (the engine's own rule), the
  // gate's own guide, and the text of every file named. The text sent is the
  // open version, saved or not; a gate's guide is relative to the workflow
  // file, as the engine reads it.
  const reviewGuides = (body: any) => {
    const { path } = locate(body.path);
    if (typeof body.text !== "string") throw new HttpError(400, "text is required");
    const parsed = parseWorkflowText(body.text);
    if (!parsed.ok) return { gates: [], files: {} };
    const p = loadProject(root);
    const files: Record<string, string> = {};
    const ref = (file: string) => {
      if (existsSync(file) && statSync(file).isFile()) files[file] ??= readFileSync(file, "utf8");
      return { path: file, display: display(p, file) };
    };
    const gates = parsed.workflow.steps.flatMap((step, stepIndex) =>
      step.gates.flatMap((gate, gateIndex) => {
        if (gate.kind !== "agent") return [];
        const resolved = { ...gate, ...(gate.guide ? { guide: isAbsolute(gate.guide) ? gate.guide : resolve(dirname(path), gate.guide) } : {}) };
        const artifacts = [...step.produces, ...step.optional_produces, ...step.updates].map((a) => a.artifact);
        const reviews = (artifacts.length ? artifacts : [undefined]).map((artifact) => {
          const found = reviewGuideSource(p, resolved, artifact);
          if (found) return { ...(artifact ? { artifact } : {}), guide: { ...ref(found.path), source: found.source } };
          const own = artifact ? libraryEntry(p, artifact)?.guide : undefined;
          return { ...(artifact ? { artifact } : {}), ...(own ? { ownGuide: ref(own) } : {}) };
        });
        return [
          {
            step: stepIndex,
            gate: gateIndex,
            ...(resolved.guide ? { gateGuide: { ...ref(resolved.guide), exists: existsSync(resolved.guide) } } : {}),
            reviews,
          },
        ];
      }),
    );
    return { gates, files };
  };

  const workstreams = () => ({
    workstreams: listWorkstreams(root).map((w) => {
      if (!w.workstream) return { slug: w.slug, error: w.error };
      let stepIds = Object.keys(w.workstream.steps);
      if (w.workflowPath) {
        const parsed = parseWorkflowText(readFileSync(w.workflowPath, "utf8"));
        if (parsed.ok) stepIds = parsed.workflow.steps.map((s) => s.id);
      }
      return {
        slug: w.slug,
        workflow: w.workstream.workflow,
        ...(w.workflowPath ? { workflowPath: w.workflowPath } : {}),
        steps: w.workstream.steps,
        events: runEvents(w.workstream),
        summary: summarizeRun(w.workstream, stepIds),
      };
    }),
  });

  // Server-sent events for one file: its new hash each time it changes. The
  // folder is watched, not the file, because editors save by replacing it.
  const watchFile = (path: string, signal: AbortSignal): Response => {
    const { path: full } = locate(path);
    const encoder = new TextEncoder();
    const read = () => (existsSync(full) ? sha(readFileSync(full, "utf8")) : null);
    let last = read();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(": watching\n\n"));
        if (!existsSync(dirname(full))) return;
        const watcher = watch(dirname(full), (_event, name) => {
          if (name && name !== basename(full)) return;
          const hash = read();
          if (hash === last) return;
          last = hash;
          controller.enqueue(encoder.encode(`event: change\ndata: ${JSON.stringify({ path: full, hash })}\n\n`));
        });
        signal.addEventListener("abort", () => {
          watcher.close();
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  };

  const serveApp = (pathname: string): Response => {
    const dir = options.appDir;
    if (!dir || !existsSync(dir)) return new Response("not found", { status: 404 });
    const file = resolve(dir, `.${decodeURIComponent(pathname)}`);
    const inside = file === resolve(dir) || file.startsWith(resolve(dir) + sep);
    const target = inside && existsSync(file) && statSync(file).isFile() ? file : join(dir, "index.html");
    return new Response(Bun.file(target));
  };

  const handle = async (req: Request, port: number): Promise<Response> => {
    const host = req.headers.get("host");
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return Response.json({ error: "foreign Host header" }, { status: 403 });
    }
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return serveApp(url.pathname);
    const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? url.searchParams.get("token");
    if (given !== token) return Response.json({ error: "missing or wrong token" }, { status: 401 });
    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const route = `${req.method} ${url.pathname}`;
    switch (route) {
      case "GET /api/session":
        return Response.json({ root, locations });
      case "GET /api/workflows":
        return Response.json({ workflows: listWorkflows() });
      case "PUT /api/workflows":
        return Response.json(updateOriginal(body));
      case "POST /api/workflows":
        return Response.json(saveNew(body));
      case "PUT /api/working-copies":
        return Response.json(putWorkingCopy(body));
      case "DELETE /api/working-copies":
        return Response.json(deleteWorkingCopy(body));
      case "GET /api/library":
        return Response.json(library());
      case "POST /api/review-guides":
        return Response.json(reviewGuides(body));
      case "GET /api/workstreams":
        return Response.json(workstreams());
      case "GET /api/watch":
        return watchFile(url.searchParams.get("path") ?? "", req.signal);
      default:
        return Response.json({ error: `no route ${route}` }, { status: 404 });
    }
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    idleTimeout: 0, // the watch stream stays open
    fetch: async (req, srv): Promise<Response> => {
      try {
        return await handle(req, srv.port ?? options.port);
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        return Response.json({ error: (e as Error).message }, { status });
      }
    },
  });

  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}
