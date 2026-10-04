// SPDX-License-Identifier: Apache-2.0
// What the policy files and the libraries say for one project: the command a
// kind of check is bound to, the round cap and review guide of an agent gate,
// an artifact's path, guide and template. Each answer follows the override
// order of decision 37, from the general to the specific: the engine's
// defaults, the user's policy, the workflow, the team's policy, the user's
// local policy for the project.

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import YAML from "yaml";
import { FlowError } from "./errors.ts";
import { libraryDirs, policyFiles } from "./project.ts";
import { DEFAULT_MAX_ROUNDS, type Gate } from "./schemas/gate.ts";
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

// The review guide an agent gate uses for one of the step's artifacts, or
// undefined when there is none: the generic review text applies then
// (decision 17).
export function reviewGuide(p: Project, gate: Gate, artifactId: string | undefined): string | undefined {
  const dirs = libraryDirs(p.root);
  const inLibrary = (dir: string) => (artifactId ? existing(join(dir, "artifacts", artifactId, "review.md")) : undefined);
  return (
    policyGuide(p.local) ??
    policyGuide(p.team) ??
    inLibrary(dirs.project) ??
    gate.guide ??
    policyGuide(p.user) ??
    inLibrary(dirs.user) ??
    inLibrary(dirs.package)
  );
}

// ------------------------------------------------------------------ artifacts

// Where an artifact lives in this workstream, relative to the repository root.
export function artifactPath(p: Project, artifact: Artifact, slug: string): string {
  const override = projectLayers(p).find((l) => l.policy.artifacts?.[artifact.artifact])?.policy.artifacts?.[artifact.artifact];
  const path = override?.path ?? artifact.path ?? p.user?.policy.artifacts?.[artifact.artifact]?.path;
  return path.replaceAll("{slug}", slug);
}

function existing(path: string): string | undefined {
  // The real path, so a guide that is a symlink to a skill's SKILL.md is read
  // where its relative references work.
  return existsSync(path) ? realpathSync(path) : undefined;
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
  const folder = [dirs.project, dirs.user, dirs.package].map((dir) => join(dir, "artifacts", id)).find((f) => existsSync(f));
  if (!folder) return undefined;
  const template = readdirSync(folder)
    .sort()
    .find((f) => /^template\.[^.]+$/.test(f));
  const guidePath = join(folder, "guide.md");
  const guide = existing(guidePath);
  const linked = !guide && (() => {
    try {
      return lstatSync(guidePath).isSymbolicLink();
    } catch {
      return false;
    }
  })();
  return { folder, guide, guideMissing: linked ? guidePath : undefined, template: template && existing(join(folder, template)) };
}

// Where a missing artifact folder was looked for.
export function libraryFolders(p: Project, id: string): string[] {
  const dirs = libraryDirs(p.root);
  return [dirs.project, dirs.user, dirs.package].map((dir) => join(dir, "artifacts", id));
}

export type LibraryLevel = "project" | "user" | "package";

export interface LibraryListing {
  id: string;
  level: LibraryLevel;
  folder: string;
  guide?: string;
  guideMissing?: string;
  template?: string;
  // The template's file name in the folder, such as template.md.
  templateFile?: string;
  review?: string;
  // The level of the entry with the same id that this one replaces, or that
  // replaces it: the most specific level wins as a whole (decision 24).
  hides?: LibraryLevel;
  hiddenBy?: LibraryLevel;
}

// Every artifact folder in the three libraries, most specific level first.
export function listLibrary(root: string): LibraryListing[] {
  const dirs = libraryDirs(root);
  const levels: LibraryLevel[] = ["project", "user", "package"];
  const found: LibraryListing[] = [];
  for (const level of levels) {
    const base = join(dirs[level], "artifacts");
    if (!existsSync(base)) continue;
    for (const id of readdirSync(base).sort()) {
      const folder = join(base, id);
      if (!statSafe(folder)) continue;
      const files = readdirSync(folder).sort();
      const template = files.find((f) => /^template\.[^.]+$/.test(f));
      const guidePath = join(folder, "guide.md");
      const guide = existing(guidePath);
      const linked = !guide && isSymlink(guidePath);
      found.push({
        id,
        level,
        folder,
        ...(guide ? { guide } : {}),
        ...(linked ? { guideMissing: guidePath } : {}),
        ...(template && existing(join(folder, template)) ? { template: existing(join(folder, template)), templateFile: template } : {}),
        ...(existing(join(folder, "review.md")) ? { review: existing(join(folder, "review.md")) } : {}),
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
