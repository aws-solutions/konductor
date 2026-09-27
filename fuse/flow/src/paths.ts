// SPDX-License-Identifier: Apache-2.0
// Project identity and file locations. A workstream is identified by the
// repository root plus its slug; every path fuse-flow writes hangs off
// <root>/.konductor.

import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export function findRepoRoot(start: string): string {
  const origin = realpathSync(resolve(start));
  let dir = origin;
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return origin;
    dir = parent;
  }
}

export function konductorDir(root: string): string {
  return join(root, ".konductor");
}

export function workflowPath(root: string): string {
  return join(konductorDir(root), "workflow.yml");
}

export function workstreamsDir(root: string): string {
  return join(konductorDir(root), "workstreams");
}

export function workstreamPath(root: string, slug: string): string {
  return join(workstreamsDir(root), `${slug}.yml`);
}

export function lockPath(root: string, slug: string): string {
  return join(workstreamsDir(root), `${slug}.lock`);
}

export function projectIdentity(root: string, slug: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`${root}\n${slug}`);
  return hasher.digest("hex").slice(0, 16);
}

export function validateSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`slug "${slug}" must be lowercase letters, digits and hyphens`);
  }
}

// Where SKILL.md files live differs per install: the package checkout keeps
// them under skills/, a Kiro install under .kiro/skills (or .konductor/skills
// when the installed package ships agents), a Claude Code install under
// .claude/skills. FUSE_SKILLS_DIR wins when set. A candidate
// counts only if it holds at least one SKILL.md so that an empty directory
// does not shadow the real one.
export function skillsDirCandidates(root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME ?? homedir();
  const out: string[] = [];
  if (env.FUSE_SKILLS_DIR) out.push(env.FUSE_SKILLS_DIR);
  // .kiro/skills comes before .konductor/skills: an agentless Kiro install
  // writes its skills to .kiro/skills, and a copy an older agent-bearing
  // install left in .konductor/skills must not shadow the current one.
  out.push(
    join(root, "skills"),
    join(root, ".kiro", "skills"),
    join(root, ".konductor", "skills"),
    join(root, ".claude", "skills"),
    ...(env.SKILLS_HOME
      ? [env.SKILLS_HOME]
      : [join(home, ".kiro", "skills"), join(home, ".konductor", "skills")]),
    join(home, ".claude", "skills"),
  );
  return out;
}

export function resolveSkillPath(root: string, skill: string, env: NodeJS.ProcessEnv = process.env): string {
  if (isAbsolute(skill)) return skill;
  for (const dir of skillsDirCandidates(root, env)) {
    const candidate = join(dir, skill);
    if (existsSync(candidate)) return candidate;
  }
  // Fall back to the first candidate so the caller still gets an absolute
  // path to report as missing.
  return join(skillsDirCandidates(root, env)[0], skill);
}

export function resolveArtifact(root: string, artifact: string): string {
  return isAbsolute(artifact) ? artifact : join(root, artifact);
}

export function isRegularFileOrDir(path: string): boolean {
  try {
    const st = statSync(path);
    return st.isFile() || st.isDirectory();
  } catch {
    return false;
  }
}
