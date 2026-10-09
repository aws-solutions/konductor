// SPDX-License-Identifier: Apache-2.0
// Regression guard: `skills/persistent-memory/SKILL.md` must never name the
// pre-rename memory root. Every path must use `.konductor/`.
//
// A single stray directive naming the old root, missed while every other
// reference in the file converged, is the exact class of bug this pins
// against, and it is silent: the skill keeps working for anyone whose state
// is already canonical, and misdirects only the reader following that one
// line.
//
// The check covers the old root's name anywhere in the file, not just the `/memory/`
// subdirectory. This package has no legacy handling of any kind, so there is
// no legitimate reason for the string to appear at all.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The pre-rename root, stored ROT13-encoded so that this test does not itself
// spell out the old name it forbids.
const rot13 = (s: string) => s.replace(/[a-z]/gi, (c) => String.fromCharCode(((c.toLowerCase().charCodeAt(0) - 97 + 13) % 26) + (c === c.toLowerCase() ? 97 : 65)));
const LEGACY_ROOT = rot13(".nfqyp");

const SKILL_MD = join(import.meta.dir, "..", "..", "skills", "persistent-memory", "SKILL.md");

describe("skills/persistent-memory/SKILL.md", () => {
  test("has no reference to the legacy memory root", () => {
    const hits = readFileSync(SKILL_MD, "utf8").split(LEGACY_ROOT).length - 1;
    expect(hits, `found ${hits} reference(s) to the legacy root in ${SKILL_MD}; every path must use '.konductor/'`).toBe(0);
  });

  // Keeps the check above from passing vacuously: the file must actually
  // reference the canonical `.konductor/memory/` path somewhere.
  test("names the canonical .konductor/memory/ directory", () => {
    expect(readFileSync(SKILL_MD, "utf8")).toContain(".konductor/memory/");
  });
});
