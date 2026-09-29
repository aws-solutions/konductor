// SPDX-License-Identifier: Apache-2.0
// Every skill that one SKILL.md tells the agent to use must exist, so removing
// or renaming a skill cannot leave another skill routing to it.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SKILLS = join(import.meta.dir, "..", "..", "skills");

// Phrasings the skills use to name another skill: "`x` skill", "skill `x`",
// "skills: `x`", "skills/x/", "load `x`", "apply the `x`".
const REFERENCES = [
  /`([a-z0-9][a-z0-9-]*)` skill\b/g,
  /\bskills?:? `([a-z0-9][a-z0-9-]*)`/g,
  /skills\/([a-z0-9][a-z0-9-]*)\//g,
  /\bload `([a-z0-9][a-z0-9-]*)`/gi,
  /\bapply the `([a-z0-9][a-z0-9-]*)`/gi,
];

describe("skill references", () => {
  test("every skill named by another skill exists", () => {
    const names = new Set(readdirSync(SKILLS).filter((name) => existsSync(join(SKILLS, name, "SKILL.md"))));
    const missing: string[] = [];
    for (const name of names) {
      const text = readFileSync(join(SKILLS, name, "SKILL.md"), "utf8");
      for (const pattern of REFERENCES) {
        for (const match of text.matchAll(pattern)) {
          if (!names.has(match[1])) missing.push(`${name} -> ${match[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
