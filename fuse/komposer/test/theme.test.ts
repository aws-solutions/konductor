// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { resolveTheme } from "../src/model/theme.ts";

describe("resolveTheme", () => {
  test("a stored choice wins over the system setting", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  test("with no stored choice the system setting decides", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  test("an unknown stored value is ignored", () => {
    expect(resolveTheme("sepia", true)).toBe("dark");
    expect(resolveTheme("", false)).toBe("light");
  });
});
