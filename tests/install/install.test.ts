// SPDX-License-Identifier: Apache-2.0
// End-to-end tests for install.sh. Each test runs the real script from a
// throwaway clone against a throwaway home directory and project.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPO_ROOT, Sandbox, exists, isLink, snapshot } from "./helpers";

const BLOCK = "# fuse-konductor\n\nRules for the agent.\n";
const wrapped = (block = BLOCK) => `<GENERATED>\n<FUSE-KONDUCTOR>\n${block}</FUSE-KONDUCTOR>\n</GENERATED>\n`;
/** The manifest's records without the checksums of the skill copies. */
const listed = (manifest: string) => readFileSync(manifest, "utf8").replace(/ \d+$/gm, "");

let sb: Sandbox;
beforeEach(() => (sb = new Sandbox()));
afterEach(() => sb.cleanup());

describe("arguments", () => {
  test("no target, both targets, an unknown option or a missing value is a usage error that writes nothing", () => {
    const before = snapshot(sb.root);
    for (const args of [
      [],
      ["--uninstall"],
      ["--project", sb.project, "--global", join(sb.home, ".claude", "CLAUDE.md")],
      ["--project"],
      ["--project", ""],
      ["--global"],
      ["--global", "--uninstall"],
      ["--project", sb.project, "--force"],
      ["--project", sb.project, "--project", sb.project],
      ["--project", sb.project, "--link"],
      ["--global", join(sb.home, ".claude", "CLAUDE.md"), "--link", "--uninstall"],
      ["--global", join(sb.home, ".claude", "CLAUDE.md"), "--link", "--link"],
    ]) {
      const result = sb.run(...args);
      expect(result.status).toBe(64);
      expect(result.stderr).toContain("usage:");
    }
    expect(snapshot(sb.root)).toEqual(before);
  });

  test("--help prints the usage and exits 0", () => {
    const result = sb.run("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("usage:");
  });

  test("a project directory that does not exist is refused", () => {
    const result = sb.run("--project", sb.path("missing"));
    expect(result.status).toBe(1);
    expect(result.output).toContain("not a directory");
    expect(exists(sb.path("missing"))).toBe(false);
  });

  test("a block source that contains a marker line is refused before anything is written", () => {
    sb.setBlock("# fuse-konductor\n</GENERATED>\n");
    const before = snapshot(sb.root);
    const result = sb.run("--project", sb.project);
    expect(result.status).toBe(1);
    expect(result.output).toContain("AGENTS.fuse.md");
    expect(snapshot(sb.root)).toEqual(before);
  });

  test("an install without Bun is refused before anything is written", () => {
    const bin = sb.path("no-bun");
    mkdirSync(bin);
    sb.write(join(bin, "bun"), "#!/bin/sh\nexit 127\n");
    chmodSync(join(bin, "bun"), 0o755);
    sb.pathPrefix = [bin];
    const before = snapshot(sb.project);
    const result = sb.run("--project", sb.project);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Bun is required");
    expect(snapshot(sb.project)).toEqual(before);
  });

  test("a block source that contains any section tag line is refused before anything is written", () => {
    sb.setBlock("# fuse-konductor\n<EXAMPLE>\ntext\n</EXAMPLE>\n");
    const before = snapshot(sb.root);
    const result = sb.run("--project", sb.project);
    expect(result.status).toBe(1);
    expect(result.output).toContain("AGENTS.fuse.md");
    expect(snapshot(sb.root)).toEqual(before);
  });
});

describe("--project", () => {
  test("copies the skills, adds the block to AGENTS.md and links the Claude Code and Kiro skill directories", () => {
    const output = sb.ok("--project", sb.project);
    const skills = join(sb.project, ".agents", "skills");
    expect(sb.read(join(skills, "alpha", "SKILL.md"))).toBe(sb.read(join(sb.clone, "skills", "alpha", "SKILL.md")));
    expect(isLink(join(skills, "alpha"))).toBe(false);
    expect(sb.read(join(skills, "beta", "SKILL.md"))).toContain("# beta");
    expect(listed(join(skills, ".fuse-konductor"))).toBe(".claude\n.kiro\nalpha\nbeta\n");
    expect(sb.read(join(sb.project, "AGENTS.md"))).toBe(wrapped());
    expect(readlinkSync(join(sb.project, ".claude", "skills"))).toBe("../.agents/skills");
    expect(readlinkSync(join(sb.project, ".kiro", "skills"))).toBe("../.agents/skills");
    expect(exists(join(sb.project, ".claude", "skills", "alpha", "SKILL.md"))).toBe(true);
    expect(output).toContain("AGENTS.md");
    expect(output).toContain(".agents/skills");
  });

  test("accepts . as the project directory", () => {
    const result = sb.run("--project", ".");
    expect(result.status).toBe(0);
    expect(exists(join(sb.root, "AGENTS.md"))).toBe(true);
    expect(exists(join(sb.root, ".agents", "skills", "alpha", "SKILL.md"))).toBe(true);
  });

  test("links skills one by one into a real .claude/skills directory and keeps its own skills", () => {
    sb.write(join(sb.project, ".claude", "skills", "own", "SKILL.md"), "mine\n");
    sb.ok("--project", sb.project);
    const claude = join(sb.project, ".claude", "skills");
    expect(isLink(claude)).toBe(false);
    expect(readlinkSync(join(claude, "alpha"))).toBe("../../.agents/skills/alpha");
    expect(sb.read(join(claude, "own", "SKILL.md"))).toBe("mine\n");
  });

  test("a second run changes nothing", () => {
    sb.ok("--project", sb.project);
    const before = snapshot(sb.root);
    sb.ok("--project", sb.project);
    expect(snapshot(sb.root)).toEqual(before);
  });

  test("a rerun replaces an edited copy with the clone's version", () => {
    sb.ok("--project", sb.project);
    sb.addSkill("alpha", "---\nname: alpha\ndescription: Use when testing again.\n---\n");
    sb.ok("--project", sb.project);
    expect(sb.read(join(sb.project, ".agents", "skills", "alpha", "SKILL.md"))).toContain("testing again");
  });

  test("a skill removed from the clone is removed from the project, and a skill added is copied", () => {
    sb.ok("--project", sb.project);
    sb.removeSkill("beta");
    sb.addSkill("gamma");
    sb.ok("--project", sb.project);
    const skills = join(sb.project, ".agents", "skills");
    expect(exists(join(skills, "beta"))).toBe(false);
    expect(exists(join(skills, "gamma", "SKILL.md"))).toBe(true);
    expect(listed(join(skills, ".fuse-konductor"))).toBe(".claude\n.kiro\nalpha\ngamma\n");
  });

  test("a skill directory it did not install is reported and left alone", () => {
    sb.write(join(sb.project, ".agents", "skills", "alpha", "SKILL.md"), "the project's own alpha\n");
    const output = sb.ok("--project", sb.project);
    const skills = join(sb.project, ".agents", "skills");
    expect(sb.read(join(skills, "alpha", "SKILL.md"))).toBe("the project's own alpha\n");
    expect(listed(join(skills, ".fuse-konductor"))).toBe(".claude\n.kiro\nbeta\n");
    expect(output).toContain("alpha");
    expect(output).toMatch(/skip/i);
  });

  test("a manifest line that is not a skill name is refused before anything changes", () => {
    sb.write(join(sb.root, "victim", "data"), "important\n");
    for (const line of ["../../../victim", "..", "a/b", ".hidden"]) {
      sb.write(join(sb.project, ".agents", "skills", ".fuse-konductor"), `${line}\n`);
      const before = snapshot(sb.root);
      for (const args of [["--project", sb.project], ["--project", sb.project, "--uninstall"]]) {
        const result = sb.run(...args);
        expect(result.status).toBe(1);
        expect(result.output).toContain("not a skill name");
        expect(snapshot(sb.root)).toEqual(before);
      }
    }
  });

  test("a symlinked manifest or skills directory is refused before anything changes", () => {
    sb.write(join(sb.root, "elsewhere.txt"), "keep\n");
    mkdirSync(join(sb.project, ".agents", "skills"), { recursive: true });
    symlinkSync(join(sb.root, "elsewhere.txt"), join(sb.project, ".agents", "skills", ".fuse-konductor"));
    const before = snapshot(sb.root);
    const result = sb.run("--project", sb.project);
    expect(result.status).toBe(1);
    expect(result.output).toContain("symlink");
    expect(snapshot(sb.root)).toEqual(before);
  });

  test("a symlinked .claude directory is skipped and nothing outside the project changes", () => {
    const outside = join(sb.root, "outside");
    sb.write(join(outside, "skills", "theirs", "SKILL.md"), "theirs\n");
    symlinkSync(outside, join(sb.project, ".claude"));
    const before = snapshot(outside);
    const output = sb.ok("--project", sb.project);
    expect(output).toContain(".claude is a symlink");
    expect(snapshot(outside)).toEqual(before);
    sb.ok("--project", sb.project, "--uninstall");
    expect(snapshot(outside)).toEqual(before);
    expect(isLink(join(sb.project, ".claude"))).toBe(true);
  });

  test("a .claude/skills link the project already had, and its own per-skill links, survive install and uninstall", () => {
    sb.write(join(sb.project, ".agents", "skills", "own", "SKILL.md"), "mine\n");
    mkdirSync(join(sb.project, ".kiro", "skills"), { recursive: true });
    symlinkSync("../../.agents/skills/own", join(sb.project, ".kiro", "skills", "own"));
    mkdirSync(join(sb.project, ".claude"));
    symlinkSync("../.agents/skills", join(sb.project, ".claude", "skills"));
    const before = snapshot(sb.project);
    sb.ok("--project", sb.project);
    expect(listed(join(sb.project, ".agents", "skills", ".fuse-konductor"))).toBe(".kiro/alpha\n.kiro/beta\nalpha\nbeta\n");
    sb.ok("--project", sb.project);
    expect(readlinkSync(join(sb.project, ".kiro", "skills", "own"))).toBe("../../.agents/skills/own");
    sb.ok("--project", sb.project, "--uninstall");
    expect(snapshot(sb.project)).toEqual(before);
  });

  test("a per-skill link the project already had for a skill it then installs is left in place", () => {
    mkdirSync(join(sb.project, ".kiro", "skills"), { recursive: true });
    symlinkSync("../../.agents/skills/alpha", join(sb.project, ".kiro", "skills", "alpha"));
    const before = snapshot(sb.project);
    sb.ok("--project", sb.project);
    expect(listed(join(sb.project, ".agents", "skills", ".fuse-konductor"))).toBe(".claude\n.kiro/beta\nalpha\nbeta\n");
    sb.removeSkill("alpha");
    sb.ok("--project", sb.project);
    expect(readlinkSync(join(sb.project, ".kiro", "skills", "alpha"))).toBe("../../.agents/skills/alpha");
    sb.addSkill("alpha");
    sb.ok("--project", sb.project);
    sb.ok("--project", sb.project, "--uninstall");
    expect(snapshot(sb.project)).toEqual(before);
  });

  test("without symlink support the harness skills are marked copies that update and uninstall cleanly", () => {
    sb.write(join(sb.project, ".claude", "skills", "own", "SKILL.md"), "mine\n");
    const before = snapshot(sb.project);
    sb.breakSymlinks();
    const output = sb.ok("--project", sb.project);
    expect(output).toContain("could not create a symlink");
    expect(sb.read(join(sb.project, ".kiro", "skills", "alpha", "SKILL.md"))).toContain("# alpha");
    sb.addSkill("alpha", "updated\n");
    sb.removeSkill("beta");
    sb.ok("--project", sb.project);
    expect(sb.read(join(sb.project, ".claude", "skills", "alpha", "SKILL.md"))).toBe("updated\n");
    expect(exists(join(sb.project, ".kiro", "skills", "beta"))).toBe(false);
    sb.ok("--project", sb.project, "--uninstall");
    expect(snapshot(sb.project)).toEqual(before);
  });

  test("a first install interrupted before a copy lands claims nothing, so a skill created later is left alone", () => {
    sb.interruptNextStagedMove();
    expect(sb.run("--project", sb.project).status).not.toBe(0);
    sb.pathPrefix = [];
    sb.env = {};
    const skills = join(sb.project, ".agents", "skills");
    const firstMissing = ["alpha", "beta"].find((name) => !exists(join(skills, name)));
    expect(firstMissing).toBeDefined();
    sb.write(join(skills, firstMissing!, "SKILL.md"), "mine\n");
    const output = sb.ok("--project", sb.project);
    expect(output).toContain("was not installed by fuse-konductor");
    expect(sb.read(join(skills, firstMissing!, "SKILL.md"))).toBe("mine\n");
  });

  test("a skill edited in the project is kept on update and uninstall, and replaced once deleted", () => {
    sb.ok("--project", sb.project);
    const skill = join(sb.project, ".agents", "skills", "alpha", "SKILL.md");
    sb.write(skill, "edited in the project\n");
    sb.addSkill("alpha", "new in the clone\n");
    const output = sb.ok("--project", sb.project);
    expect(output).toContain("edited in the project");
    expect(sb.read(skill)).toBe("edited in the project\n");
    expect(sb.ok("--project", sb.project, "--uninstall")).toContain("edited in the project - kept");
    expect(sb.read(skill)).toBe("edited in the project\n");
    expect(exists(join(sb.project, ".agents", "skills", "beta"))).toBe(false);
    sb.ok("--project", sb.project);
    rmSync(join(sb.project, ".agents", "skills", "alpha"), { recursive: true });
    sb.ok("--project", sb.project);
    expect(sb.read(skill)).toBe("new in the clone\n");
  });

  test("a manifest record without a checksum keeps a copy that differs from the clone, on update and uninstall", () => {
    sb.ok("--project", sb.project);
    const list = join(sb.project, ".agents", "skills", ".fuse-konductor");
    sb.write(list, listed(list));
    const skill = join(sb.project, ".agents", "skills", "alpha", "SKILL.md");
    sb.write(skill, "edited under the old manifest\n");
    expect(sb.ok("--project", sb.project)).toContain("edited in the project");
    expect(sb.read(skill)).toBe("edited under the old manifest\n");
    sb.write(list, listed(list));
    expect(sb.ok("--project", sb.project, "--uninstall")).toContain("edited in the project - kept");
    expect(sb.read(skill)).toBe("edited under the old manifest\n");
    expect(exists(join(sb.project, ".agents", "skills", "beta"))).toBe(false);
  });

  test("making a project copy's script executable counts as an edit, with or without a checksum record", () => {
    for (const bare of [false, true]) {
      const box = new Sandbox();
      try {
        box.write(join(box.clone, "skills", "alpha", "run.sh"), "echo one\n");
        box.ok("--project", box.project);
        const list = join(box.project, ".agents", "skills", ".fuse-konductor");
        if (bare) box.write(list, listed(list));
        const script = join(box.project, ".agents", "skills", "alpha", "run.sh");
        chmodSync(script, 0o755);
        box.ok("--project", box.project);
        box.write(join(box.clone, "skills", "alpha", "run.sh"), "echo two\n");
        expect(box.ok("--project", box.project)).toContain("edited in the project");
        expect(statSync(script).mode & 0o100).toBe(0o100);
        expect(box.read(script)).toBe("echo one\n");
        expect(box.ok("--project", box.project, "--uninstall")).toContain("edited in the project - kept");
        expect(box.read(script)).toBe("echo one\n");
      } finally {
        box.cleanup();
      }
    }
  });

  test("an update interrupted while a copy is being replaced keeps the old copy", () => {
    sb.ok("--project", sb.project);
    const skill = join(sb.project, ".agents", "skills", "alpha", "SKILL.md");
    const before = sb.read(skill);
    sb.addSkill("alpha", "edited\n");
    sb.interruptNextStagedMove();
    expect(sb.run("--project", sb.project).status).not.toBe(0);
    expect(sb.read(skill)).toBe(before);
    sb.pathPrefix = [];
    sb.ok("--project", sb.project);
    expect(sb.read(skill)).toBe("edited\n");
  });

  test("a first install interrupted after a copy is in place is finished by the next run", () => {
    sb.interruptNextStagedMove(true);
    expect(sb.run("--project", sb.project).status).not.toBe(0);
    sb.pathPrefix = [];
    const output = sb.ok("--project", sb.project);
    expect(output).not.toContain("was not installed by fuse-konductor");
    expect(listed(join(sb.project, ".agents", "skills", ".fuse-konductor"))).toBe(".claude\n.kiro\nalpha\nbeta\n");
    const leftovers = Object.keys(snapshot(sb.project)).filter((p) => p.includes(".fuse-konductor."));
    expect(leftovers).toEqual([]);
  });

  test("a manifest with Windows line endings is read, updated and uninstalled", () => {
    sb.ok("--project", sb.project);
    const list = join(sb.project, ".agents", "skills", ".fuse-konductor");
    sb.write(list, sb.read(list).replaceAll("\n", "\r\n"));
    sb.ok("--project", sb.project);
    sb.ok("--project", sb.project, "--uninstall");
    expect(snapshot(sb.project)).toEqual({});
  });

  test("a project path with a newline is a usage error", () => {
    const result = sb.run("--project", `${sb.project}\nchild`);
    expect(result.status).toBe(64);
  });

  test("--uninstall restores the project exactly as it was", () => {
    sb.write(join(sb.project, "AGENTS.md"), "# Team rules\n\nBe kind.\n");
    sb.write(join(sb.project, ".agents", "skills", "own", "SKILL.md"), "mine\n");
    sb.write(join(sb.project, "src", "main.ts"), "export {};\n");
    const before = snapshot(sb.project);
    sb.ok("--project", sb.project);
    sb.ok("--project", sb.project, "--uninstall");
    expect(snapshot(sb.project)).toEqual(before);
  });

  test("--uninstall removes a project install from an empty project completely", () => {
    sb.ok("--project", sb.project);
    sb.ok("--project", sb.project, "--uninstall");
    expect(snapshot(sb.project)).toEqual({});
  });
});

describe("--global", () => {
  const files = () => ({
    claude: join(sb.home, ".claude", "CLAUDE.md"),
    codex: join(sb.home, ".codex", "AGENTS.md"),
    kiro: join(sb.home, ".kiro", "steering", "AGENTS.md"),
  });

  const marked = (dir: string) => sb.read(join(dir, ".fuse-konductor-copy")) === `${join(sb.clone, "skills")}\n`;

  test("adds the block to each file and copies the skills next to it", () => {
    const f = files();
    const output = sb.ok("--global", f.claude, f.codex, f.kiro);
    for (const file of [f.claude, f.codex, f.kiro]) expect(sb.read(file)).toBe(wrapped());
    for (const dir of [".claude/skills", ".codex/skills", ".kiro/skills"]) {
      for (const name of ["alpha", "beta"]) {
        const skill = join(sb.home, dir, name);
        expect(isLink(skill)).toBe(false);
        expect(sb.read(join(skill, "SKILL.md"))).toBe(sb.read(join(sb.clone, "skills", name, "SKILL.md")));
        expect(marked(skill)).toBe(true);
      }
    }
    expect(exists(join(sb.home, ".kiro", "steering", "skills"))).toBe(false);
    expect(output).toContain(f.claude);
    expect(output).toContain(join(sb.home, ".kiro", "skills"));
    expect(output).not.toContain("could not create a symlink");
  });

  test("a rerun updates the copies from the clone", () => {
    sb.ok("--global", files().claude);
    sb.addSkill("alpha", "edited\n");
    expect(sb.read(join(sb.home, ".claude", "skills", "alpha", "SKILL.md"))).not.toBe("edited\n");
    sb.ok("--global", files().claude);
    expect(sb.read(join(sb.home, ".claude", "skills", "alpha", "SKILL.md"))).toBe("edited\n");
  });

  test("--link links the skills into the clone, so edits in the clone are live", () => {
    const f = files();
    const output = sb.ok("--global", f.claude, f.kiro, "--link");
    for (const dir of [".claude/skills", ".kiro/skills"]) {
      expect(readlinkSync(join(sb.home, dir, "alpha"))).toBe(join(sb.clone, "skills", "alpha"));
      expect(readlinkSync(join(sb.home, dir, "beta"))).toBe(join(sb.clone, "skills", "beta"));
    }
    expect(output).toContain("linked");
    sb.addSkill("alpha", "edited\n");
    expect(sb.read(join(sb.home, ".claude", "skills", "alpha", "SKILL.md"))).toBe("edited\n");
  });

  test("--link turns earlier copies into links, and a run without it turns links back into copies", () => {
    const skills = join(sb.home, ".claude", "skills");
    sb.write(join(skills, "own", "SKILL.md"), "mine\n");
    symlinkSync(join(sb.root, "elsewhere"), join(skills, "other"));
    sb.ok("--global", files().claude);
    sb.ok("--global", files().claude, "--link");
    expect(readlinkSync(join(skills, "alpha"))).toBe(join(sb.clone, "skills", "alpha"));
    expect(readlinkSync(join(skills, "beta"))).toBe(join(sb.clone, "skills", "beta"));
    sb.ok("--global", files().claude);
    for (const name of ["alpha", "beta"]) {
      expect(isLink(join(skills, name))).toBe(false);
      expect(marked(join(skills, name))).toBe(true);
    }
    expect(sb.read(join(skills, "own", "SKILL.md"))).toBe("mine\n");
    expect(readlinkSync(join(skills, "other"))).toBe(join(sb.root, "elsewhere"));
    const leftovers = Object.keys(snapshot(skills)).filter((p) => p.includes(".fuse-konductor-old.") || p.startsWith(".fuse-konductor."));
    expect(leftovers).toEqual([]);
  });

  test("a second run changes nothing, with or without --link", () => {
    const f = files();
    for (const extra of [[], ["--link"]]) {
      sb.ok("--global", f.claude, f.codex, f.kiro, ...extra);
      const before = snapshot(sb.home);
      sb.ok("--global", f.claude, f.codex, f.kiro, ...extra);
      expect(snapshot(sb.home)).toEqual(before);
    }
  });

  test("a symlinked instruction file is edited in place and stays a link", () => {
    const real = join(sb.root, "dotfiles", "CLAUDE.md");
    sb.write(real, "# Mine\n");
    mkdirSync(join(sb.home, ".claude"));
    symlinkSync(real, files().claude);
    sb.ok("--global", files().claude);
    expect(isLink(files().claude)).toBe(true);
    expect(sb.read(real)).toBe(`# Mine\n\n${wrapped()}`);
  });

  test("a skill removed from the clone is removed; entries it did not create are left alone", () => {
    const skills = join(sb.home, ".claude", "skills");
    sb.write(join(skills, "own", "SKILL.md"), "mine\n");
    sb.write(join(sb.root, "elsewhere", "other", "SKILL.md"), "other\n");
    symlinkSync(join(sb.root, "elsewhere", "other"), join(skills, "other"));
    symlinkSync(join(sb.root, "unmounted", "gone"), join(skills, "gone"));
    sb.ok("--global", files().claude);
    sb.removeSkill("beta");
    sb.ok("--global", files().claude);
    expect(exists(join(skills, "beta"))).toBe(false);
    expect(marked(join(skills, "alpha"))).toBe(true);
    expect(sb.read(join(skills, "own", "SKILL.md"))).toBe("mine\n");
    expect(readlinkSync(join(skills, "other"))).toBe(join(sb.root, "elsewhere", "other"));
    expect(readlinkSync(join(skills, "gone"))).toBe(join(sb.root, "unmounted", "gone"));
  });

  test("a skill directory it did not install is reported and left alone", () => {
    sb.write(join(sb.home, ".claude", "skills", "alpha", "SKILL.md"), "konductor's alpha\n");
    const output = sb.ok("--global", files().claude);
    expect(sb.read(join(sb.home, ".claude", "skills", "alpha", "SKILL.md"))).toBe("konductor's alpha\n");
    expect(marked(join(sb.home, ".claude", "skills", "beta"))).toBe(true);
    expect(output).toMatch(/skip/i);
  });

  test("a skill whose SKILL.md is removed from the clone is removed, as a copy or a link", () => {
    for (const extra of [[], ["--link"]]) {
      sb.addSkill("beta");
      sb.ok("--global", files().claude, ...extra);
      rmSync(join(sb.clone, "skills", "beta", "SKILL.md"));
      sb.ok("--global", files().claude, ...extra);
      expect(exists(join(sb.home, ".claude", "skills", "beta"))).toBe(false);
    }
  });

  test("--link without symlink support falls back to marked copies that update and uninstall cleanly", () => {
    sb.write(join(sb.home, ".claude", "skills", "own", "SKILL.md"), "mine\n");
    sb.write(join(sb.home, ".claude", "skills", ".fuse-konductor-new.alpha", "notes.md"), "not the script's\n");
    const before = snapshot(sb.home);
    sb.breakSymlinks();
    const output = sb.ok("--global", files().claude, "--link");
    expect(output).toContain("could not create a symlink");
    sb.addSkill("alpha", "updated\n");
    sb.removeSkill("beta");
    sb.ok("--global", files().claude, "--link");
    const leftovers = Object.keys(snapshot(join(sb.home, ".claude"))).filter((p) => /\.fuse-konductor(-old)?\.[A-Za-z0-9]{6}/.test(p));
    expect(leftovers).toEqual([]);
    expect(sb.read(join(sb.home, ".claude", "skills", "alpha", "SKILL.md"))).toBe("updated\n");
    expect(exists(join(sb.home, ".claude", "skills", "beta"))).toBe(false);
    expect(sb.read(join(sb.home, ".claude", "skills", "own", "SKILL.md"))).toBe("mine\n");
    sb.ok("--global", files().claude, "--uninstall");
    expect(snapshot(sb.home)).toEqual(before);
  });

  test("an update interrupted while a copy is being replaced leaves the old copy in place", () => {
    sb.ok("--global", files().claude);
    const before = snapshot(sb.home);
    sb.addSkill("alpha", "updated\n");
    sb.interruptNextStagedMove();
    const result = sb.run("--global", files().claude);
    expect(result.status).not.toBe(0);
    expect(snapshot(sb.home)).toEqual(before);
  });

  test("an update interrupted right after a copy was replaced leaves the new copy and no backup", () => {
    sb.ok("--global", files().claude);
    sb.addSkill("alpha", "updated\n");
    sb.interruptNextStagedMove(true);
    const result = sb.run("--global", files().claude);
    expect(result.status).not.toBe(0);
    expect(sb.read(join(sb.home, ".claude", "skills", "alpha", "SKILL.md"))).toBe("updated\n");
    const leftovers = Object.keys(snapshot(join(sb.home, ".claude"))).filter((p) => p.includes(".fuse-konductor-old.") || p.includes("/.fuse-konductor."));
    expect(leftovers).toEqual([]);
  });

  test("a copy that is not marked with this clone is treated as someone else's", () => {
    sb.write(join(sb.home, ".claude", "skills", "alpha", "SKILL.md"), "other\n");
    sb.write(join(sb.home, ".claude", "skills", "alpha", ".fuse-konductor-copy"), "/some/other/clone/skills\n");
    sb.ok("--global", files().claude);
    sb.ok("--global", files().claude, "--uninstall");
    expect(sb.read(join(sb.home, ".claude", "skills", "alpha", "SKILL.md"))).toBe("other\n");
  });

  test("--uninstall restores every file and skills directory exactly as it was", () => {
    const f = files();
    sb.write(f.claude, "# Mine\n\nLine without newline at the end");
    sb.write(f.codex, "# Codex\r\nWindows line endings\r\n");
    sb.write(join(sb.home, ".claude", "skills", "own", "SKILL.md"), "mine\n");
    sb.write(join(sb.home, ".kiro", "steering", "AGENTS.md"), "");
    const before = snapshot(sb.home);
    sb.ok("--global", f.claude, f.codex, f.kiro);
    sb.ok("--global", f.claude, f.codex, f.kiro, "--uninstall");
    expect(snapshot(sb.home)).toEqual(before);
  });

  test("--uninstall of a fresh install leaves no file, no link and no directory it created", () => {
    const f = files();
    for (const extra of [[], ["--link"]]) {
      sb.ok("--global", f.claude, f.codex, f.kiro, ...extra);
      sb.ok("--global", f.claude, f.codex, f.kiro, "--uninstall");
      expect(snapshot(sb.home)).toEqual({});
    }
  });
});

describe("the managed block", () => {
  const target = () => join(sb.home, ".claude", "CLAUDE.md");

  test("is appended after existing content, which stays byte for byte the same", () => {
    const original = "# Mine\r\n\r\nWindows line endings\r\n";
    sb.write(target(), original);
    sb.ok("--global", target());
    expect(sb.read(target())).toBe(`${original}\n${wrapped()}`);
  });

  test("a file without a final newline keeps its last line intact", () => {
    sb.write(target(), "# Mine\nlast line");
    sb.ok("--global", target());
    expect(sb.read(target())).toBe(`# Mine\nlast line\n${wrapped()}`);
  });

  test("is replaced in place when the block source changes, and nothing outside it moves", () => {
    sb.write(target(), "# Mine\n");
    sb.ok("--global", target());
    sb.write(target(), `${sb.read(target())}\nAdded by the user later\nwithout a final newline`);
    const before = sb.read(target());
    sb.setBlock("# fuse-konductor\n\nNew rules.\n");
    sb.ok("--global", target());
    expect(sb.read(target())).toBe(before.replace("Rules for the agent.", "New rules."));
  });

  test("a block source without a final newline is written as whole lines", () => {
    sb.setBlock("# fuse-konductor");
    sb.ok("--global", target());
    expect(sb.read(target())).toBe(wrapped("# fuse-konductor\n"));
  });

  test("shares one GENERATED wrapper with DCP and leaves DCP's section alone", () => {
    const dcp = "# Operating guide\n<GENERATED>\n<DECENTLY-CAPABLE-POWERS>\nDCP rules\n</DECENTLY-CAPABLE-POWERS>\n</GENERATED>\n";
    sb.write(target(), dcp);
    sb.ok("--global", target());
    expect(sb.read(target())).toBe(
      "# Operating guide\n<GENERATED>\n<DECENTLY-CAPABLE-POWERS>\nDCP rules\n</DECENTLY-CAPABLE-POWERS>\n" +
        `<FUSE-KONDUCTOR>\n${BLOCK}</FUSE-KONDUCTOR>\n</GENERATED>\n`,
    );
    sb.ok("--global", target(), "--uninstall");
    expect(sb.read(target())).toBe(dcp);
  });

  test("keeps the file's permissions", () => {
    sb.write(target(), "# Mine\n");
    chmodSync(target(), 0o600);
    sb.ok("--global", target());
    expect(statSync(target()).mode & 0o777).toBe(0o600);
    sb.ok("--global", target(), "--uninstall");
    expect(statSync(target()).mode & 0o777).toBe(0o600);
  });

  test("a malformed section of another tool inside the wrapper is refused", () => {
    for (const content of [
      "<GENERATED>\n<DECENTLY-CAPABLE-POWERS>\nnever closed\n</GENERATED>\n",
      "<GENERATED>\n<DECENTLY-CAPABLE-POWERS>\n</DECENTLY-COORDINATED-LOOPS>\n</GENERATED>\n",
      "<GENERATED>\n<DECENTLY-CAPABLE-POWERS>\n<FUSE-KONDUCTOR>\nx\n</FUSE-KONDUCTOR>\n</DECENTLY-CAPABLE-POWERS>\n</GENERATED>\n",
    ]) {
      sb.write(target(), content);
      const result = sb.run("--global", target());
      expect(result.status).toBe(1);
      expect(sb.read(target())).toBe(content);
    }
  });

  test("a tag mentioned inside a longer line is prose, not a marker", () => {
    const original = "Our tools write a <GENERATED> block below.\n";
    sb.write(target(), original);
    sb.ok("--global", target());
    expect(sb.read(target())).toBe(`${original}\n${wrapped()}`);
  });

  test("malformed or unclear markers are reported, the file is left alone, and other targets still install", () => {
    const cases = [
      "<GENERATED>\nnever closed\n",
      "</GENERATED>\n",
      "<GENERATED>\n</GENERATED>\n<GENERATED>\n</GENERATED>\n",
      "<FUSE-KONDUCTOR>\noutside\n</FUSE-KONDUCTOR>\n",
      "<GENERATED>\n<FUSE-KONDUCTOR>\n</GENERATED>\n",
      "<GENERATED>\n<FUSE-KONDUCTOR>\na\n</FUSE-KONDUCTOR>\n<FUSE-KONDUCTOR>\nb\n</FUSE-KONDUCTOR>\n</GENERATED>\n",
    ];
    const codex = join(sb.home, ".codex", "AGENTS.md");
    for (const content of cases) {
      sb.write(target(), content);
      const result = sb.run("--global", target(), codex);
      expect(result.status).toBe(1);
      expect(result.output).toContain(target());
      expect(sb.read(target())).toBe(content);
      expect(sb.read(codex)).toBe(wrapped());
    }
  });
});

describe("this repository", () => {
  // The validator lookup in skills/persistent-memory/SKILL.md, run from each
  // supported install layout.
  test("persistent-memory finds its validator in project and user-level installs", () => {
    const real = new Sandbox([]);
    try {
      cpSync(join(REPO_ROOT, "skills", "persistent-memory"), join(real.clone, "skills", "persistent-memory"), { recursive: true });
      const skill = readFileSync(join(REPO_ROOT, "skills", "persistent-memory", "SKILL.md"), "utf8");
      const snippet = skill.match(/```bash\n\s*(VALIDATOR=[\s\S]*?)\n\s*printf/)?.[1];
      expect(snippet).toBeDefined();
      const find = (cwd: string) =>
        Bun.spawnSync(["bash", "-c", `${snippet}\nprintf '%s' "$VALIDATOR"`], {
          cwd,
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: real.home },
        }).stdout.toString();
      real.ok("--project", real.project);
      expect(find(real.project)).toBe(".agents/skills/persistent-memory/scripts/memory-validator.sh");
      for (const file of [join(".codex", "AGENTS.md"), join(".config", "opencode", "AGENTS.md")]) {
        const other = real.path(`elsewhere-${file.split("/")[1]}`);
        mkdirSync(other);
        real.ok("--global", join(real.home, file));
        expect(find(other)).toBe(join(real.home, dirname(file), "skills", "persistent-memory", "scripts", "memory-validator.sh"));
        real.ok("--global", join(real.home, file), "--uninstall");
      }
    } finally {
      real.cleanup();
    }
  });
  test("AGENTS.fuse.md is under 8 KiB and contains no marker line", () => {
    const text = readFileSync(join(REPO_ROOT, "AGENTS.fuse.md"), "utf8");
    expect(statSync(join(REPO_ROOT, "AGENTS.fuse.md")).size).toBeLessThan(8 * 1024);
    for (const line of text.split("\n")) {
      expect(["<GENERATED>", "</GENERATED>", "<FUSE-KONDUCTOR>", "</FUSE-KONDUCTOR>"]).not.toContain(line.trim());
    }
  });

  test("installs every skill in skills/ into a project", () => {
    const real = new Sandbox([]);
    try {
      const result = Bun.spawnSync(["sh", join(REPO_ROOT, "install.sh"), "--project", real.project], {
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: real.home },
      });
      expect(result.exitCode).toBe(0);
      const names = real
        .read(join(real.project, ".agents", "skills", ".fuse-konductor"))
        .trim()
        .split("\n")
        .filter((line) => !line.startsWith("."))
        .map((line) => line.split(" ")[0]);
      const expected = [...new Bun.Glob("*/SKILL.md").scanSync(join(REPO_ROOT, "skills"))].map((p) => p.split("/")[0]).sort();
      expect(names).toEqual(expected);
      expect(real.read(join(real.project, "AGENTS.md"))).toContain(readFileSync(join(REPO_ROOT, "AGENTS.fuse.md"), "utf8"));
    } finally {
      real.cleanup();
    }
  });
});
