// SPDX-License-Identifier: Apache-2.0
// What the policy files and the libraries say for one project: the command a
// kind of check is bound to, the round cap and review guide of an agent gate,
// an artifact's path, guide and template. Each answer follows the override
// order of decision 37, from the general to the specific: the engine's
// defaults, the user's policy, the workflow, the team's policy, the user's
// local policy for the project.

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import { FlowError } from "./errors.ts";
import { libraryDirs, policyFiles } from "./project.ts";
import { DEFAULT_MAX_ROUNDS, type Gate } from "./schemas/gate.ts";
import { LibraryEntrySchema } from "./schemas/library.ts";
import { type Policy, PolicySchema } from "./schemas/policy.ts";
import type { Artifact } from "./schemas/step.ts";

interface Layer {
  file: string;
  policy: Policy;
}

export interface Project {
  root: string;
  user?: Layer;
  team?: Layer;
  local?: Layer;
}

function readLayer(file: string): Layer | undefined {
  if (!existsSync(file)) return undefined;
  let yaml: unknown;
  try {
    yaml = YAML.parse(readFileSync(file, "utf8")) ?? {};
  } catch (e) {
    throw new FlowError(`${file} is not valid YAML: ${(e as Error).message}`);
  }
  const parsed = PolicySchema.safeParse(yaml);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(top level)"}: ${i.message}`);
    throw new FlowError(`${file} is not a valid policy file:\n${issues.join("\n")}`);
  }
  return { file, policy: parsed.data };
}

export function loadProject(root: string): Project {
  const files = policyFiles(root);
  return { root, user: readLayer(files.user), team: readLayer(files.team), local: readLayer(files.local) };
}

// The project's layers, most specific first, then the user's.
const projectLayers = (p: Project) => [p.local, p.team].filter((l): l is Layer => l !== undefined);

// A path as the agent should see it: relative to the repository root when it
// is inside it.
export function display(p: Project, path: string): string {
  const rel = relative(p.root, path);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
}

// ------------------------------------------------------------------ checks

export type CheckBinding = { command: string; file: string } | { command: "none"; file: string } | undefined;

export function checkBinding(p: Project, kind: string): CheckBinding {
  for (const layer of [p.local, p.team, p.user]) {
    const command = layer?.policy.checks?.[kind];
    if (command !== undefined) return { command, file: layer!.file };
  }
  return undefined;
}

// ------------------------------------------------------------------ review

export function maxRounds(p: Project, gate: Gate): number {
  for (const layer of projectLayers(p)) {
    if (layer.policy.review?.max_rounds !== undefined) return layer.policy.review.max_rounds;
  }
  return gate.max_rounds ?? p.user?.policy.review?.max_rounds ?? DEFAULT_MAX_ROUNDS;
}

export function reviewer(p: Project): string | undefined {
  for (const layer of [p.local, p.team, p.user]) {
    if (layer?.policy.review?.reviewer) return layer.policy.review.reviewer;
  }
  return undefined;
}

function policyGuide(layer: Layer | undefined): string | undefined {
  const guide = layer?.policy.review?.guide;
  return guide === undefined ? undefined : isAbsolute(guide) ? guide : resolve(dirname(layer!.file), guide);
}

export type ReviewGuideSource =
  | "local policy"
  | "team policy"
  | "project library"
  | "gate"
  | "user policy"
  | "user library"
  | "package library";

// The review guide an agent gate uses for one of the step's artifacts, and
// which layer it comes from, or undefined when there is none: the generic
// review text applies then (decision 17).
export function reviewGuideSource(
  p: Project,
  gate: Gate,
  artifactId: string | undefined,
): { path: string; source: ReviewGuideSource } | undefined {
  const dirs = libraryDirs(p.root);
  // Only the winning entry's review.md counts: the entry wins as a whole, as
  // for its guide and template, and the libraries it replaces are not looked at.
  const winner = artifactId ? libraryEntry(p, artifactId)?.folder : undefined;
  const inLibrary = (dir: string) =>
    winner && winner.startsWith(join(dir, "artifacts") + sep) ? existing(join(winner, "review.md")) : undefined;
  const order: [ReviewGuideSource, () => string | undefined][] = [
    ["local policy", () => policyGuide(p.local)],
    ["team policy", () => policyGuide(p.team)],
    ["project library", () => inLibrary(dirs.project)],
    ["gate", () => gate.guide],
    ["user policy", () => policyGuide(p.user)],
    ["user library", () => inLibrary(dirs.user)],
    ["package library", () => inLibrary(dirs.package)],
  ];
  for (const [source, find] of order) {
    const path = find();
    if (path) return { path, source };
  }
  return undefined;
}

export function reviewGuide(p: Project, gate: Gate, artifactId: string | undefined): string | undefined {
  return reviewGuideSource(p, gate, artifactId)?.path;
}

// ------------------------------------------------------------------ artifacts

// Where an artifact lives in this workstream, relative to the repository root.
// `date` is the day the workstream started, YYYY-MM-DD, so the path stays the
// same for the whole workstream.
export function artifactPath(p: Project, artifact: Artifact, slug: string, date: string): string {
  const override = projectLayers(p).find((l) => l.policy.artifacts?.[artifact.artifact])?.policy.artifacts?.[artifact.artifact];
  const path = override?.path ?? artifact.path ?? p.user?.policy.artifacts?.[artifact.artifact]?.path;
  return path.replaceAll("{slug}", slug).replaceAll("{date}", date);
}

function existing(path: string): string | undefined {
  // The real path, so a guide that is a symlink to a skill's SKILL.md is read
  // where its relative references work.
  return existsSync(path) ? realpathSync(path) : undefined;
}

// Every entry folder below <library>/artifacts/, at any depth, following
// symlinks. A folder that holds only folders groups entries; any other folder
// is an entry, named by the folder, so an id is found wherever it is filed.
// `group` is the path of the grouping folders above it, "" at the top.
export interface EntryFolder {
  id: string;
  folder: string;
  group: string;
}

function entryFoldersIn(libraryDir: string): EntryFolder[] {
  const base = join(libraryDir, "artifacts");
  if (!statSafe(base)) return [];
  const seen = new Set<string>();
  const found: EntryFolder[] = [];
  const walk = (folder: string, group: string) => {
    const real = realpathSync(folder);
    if (seen.has(real)) return; // a symlink loop is walked once
    seen.add(real);
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      if (name.startsWith(".") || !statSafe(path)) continue;
      // Hidden files count: a .keep makes a folder an entry with no guide.
      const children = readdirSync(path);
      if (children.length > 0 && children.every((c) => statSafe(join(path, c)))) {
        walk(path, group ? `${group}/${name}` : name);
      } else {
        found.push({ id: name, folder: path, group });
      }
    }
  };
  walk(base, "");
  return found;
}

// An id's folder in one library. An id filed twice in one library is refused
// rather than guessed, as a workflow name is.
function entryFolder(libraryDir: string, id: string): string | undefined {
  const matches = entryFoldersIn(libraryDir).filter((e) => e.id === id);
  if (matches.length > 1) {
    throw new FlowError(`artifact "${id}" is ambiguous; rename one of: ${matches.map((m) => m.folder).join(", ")}`);
  }
  return matches[0]?.folder;
}

// An artifact's folder in the library: the project's own replaces the user's,
// which replaces the package's (decisions 16 and 24). Its guide and template
// come from that folder only; undefined when no library has the artifact. A
// folder without guide.md is an artifact without a guide; a guide.md that
// cannot be read, such as a symlink to a skill that is not installed, is a
// missing guide (decision 11).
export function libraryEntry(
  p: Project,
  id: string,
): { folder: string; guide?: string; guideMissing?: string; template?: string } | undefined {
  const dirs = libraryDirs(p.root);
  // The first library that has the id wins; the ones it replaces are not looked at.
  let folder: string | undefined;
  for (const dir of [dirs.project, dirs.user, dirs.package]) {
    folder = entryFolder(dir, id);
    if (folder) break;
  }
  if (!folder) return undefined;
  const template = readdirSync(folder)
    .sort()
    .find((f) => /^template\.[^.]+$/.test(f));
  const guidePath = join(folder, "guide.md");
  const guide = existing(guidePath);
  const linked = !guide && isSymlink(guidePath);
  return { folder, guide, guideMissing: linked ? guidePath : undefined, template: template && existing(join(folder, template)) };
}

export type LibraryLevel = "project" | "user" | "package";

export interface LibraryListing {
  id: string;
  level: LibraryLevel;
  folder: string;
  // The grouping folders between artifacts/ and the entry, such as "writing"; "" at the top.
  group: string;
  guide?: string;
  guideMissing?: string;
  template?: string;
  // The template's file name in the folder, such as template.md.
  templateFile?: string;
  review?: string;
  // From the folder's entry.yml, when it has one that matches its schema.
  description?: string;
  // Why entry.yml could not be read, when it exists but does not match.
  entryProblem?: string;
  // The level of the entry with the same id that this one replaces, or that
  // replaces it: the most specific level wins as a whole (decision 24).
  hides?: LibraryLevel;
  hiddenBy?: LibraryLevel;
}

// Every entry in the three libraries, at any depth, most specific level first.
export function listLibrary(root: string): LibraryListing[] {
  const dirs = libraryDirs(root);
  const levels: LibraryLevel[] = ["project", "user", "package"];
  const found: LibraryListing[] = [];
  for (const level of levels) {
    const inLevel = entryFoldersIn(dirs[level]);
    for (const { id, folder, group } of inLevel) {
      const twins = inLevel.filter((e) => e.id === id && e.folder !== folder);
      const files = readdirSync(folder).sort();
      const template = files.find((f) => /^template\.[^.]+$/.test(f));
      const guidePath = join(folder, "guide.md");
      const guide = existing(guidePath);
      const linked = !guide && isSymlink(guidePath);
      const entryFile = readEntryFile(join(folder, "entry.yml"));
      if (twins.length) {
        entryFile.entryProblem = `the id is ambiguous in this library; rename one of: ${[folder, ...twins.map((t) => t.folder)].join(", ")}`;
      }
      found.push({
        id,
        level,
        folder,
        group,
        ...(guide ? { guide } : {}),
        ...(linked ? { guideMissing: guidePath } : {}),
        ...(template && existing(join(folder, template)) ? { template: existing(join(folder, template)), templateFile: template } : {}),
        ...(existing(join(folder, "review.md")) ? { review: existing(join(folder, "review.md")) } : {}),
        ...entryFile,
      });
    }
  }
  for (const entry of found) {
    const same = found.filter((e) => e.id === entry.id);
    const winner = same[0];
    if (winner === entry && same.length > 1) entry.hides = same[1].level;
    if (winner !== entry) entry.hiddenBy = winner.level;
  }
  return found;
}

// An entry's entry.yml. A file that does not match its schema is reported on
// the entry, so one bad file does not hide the rest of the library.
function readEntryFile(path: string): { description?: string; entryProblem?: string } {
  if (!existsSync(path)) return {};
  let yaml: unknown;
  try {
    yaml = YAML.parse(readFileSync(path, "utf8")) ?? {};
  } catch (e) {
    return { entryProblem: `${path} is not valid YAML: ${(e as Error).message}` };
  }
  const parsed = LibraryEntrySchema.safeParse(yaml);
  if (parsed.success) return { description: parsed.data.description };
  const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(top level)"}: ${i.message}`);
  return { entryProblem: `${path}: ${issues.join("; ")}` };
}

function statSafe(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
