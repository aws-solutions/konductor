// SPDX-License-Identifier: Apache-2.0
/**
 * Holds the colours of run-checks.css to the palette, and checks that the
 * pairs the check marks draw reach WCAG AA in both modes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';
import { colorsOf, type ThemeMode } from '../src/theme/tokens.ts';

// The text of the sheet, not the sheet itself, so this test reads the
// declarations the browser would apply.
const CSS = readFileSync(
  fileURLToPath(new URL('../src/execution/run-checks.css', import.meta.url)),
  'utf8',
);

const MODES: ThemeMode[] = ['light', 'dark'];

// The block of declarations for one mode: the dark one is the rule whose
// selectors name the dark theme, the light one is the rule before it.
function blockOf(mode: ThemeMode): string {
  const blocks = [...CSS.matchAll(/\{([^{}]*)\}/g)].map(
    (match) => match[1] ?? '',
  );
  // A block that sets the colours, not one that only reads them with `var`.
  const declared = blocks.filter((block) => /--wf-check-[a-z-]+:/.test(block));
  const [light, dark] = declared;
  expect(declared, 'one block of colours per mode').toHaveLength(2);
  return (mode === 'dark' ? dark : light) ?? '';
}

function valueOf(mode: ThemeMode, name: string): string {
  const found = new RegExp(`--wf-check-${name}:\\s*([^;]+);`).exec(
    blockOf(mode),
  );
  expect(found, `--wf-check-${name} in the ${mode} block`).not.toBeNull();
  return (found?.[1] ?? '').trim();
}

describe.each(MODES)('the %s check marks', (mode) => {
  const c = colorsOf(mode);

  it.each([
    ['text', 'text'],
    ['text-muted', 'textMuted'],
    ['pending-bg', 'surfaceAlt'],
    ['done', 'success'],
    ['done-bg', 'successBg'],
  ] as const)('draws --wf-check-%s with the palette colour', (name, token) => {
    expect(valueOf(mode, name)).toBe(c[token]);
  });

  it('has AA contrast for a check the run has verified', () => {
    expect(
      contrastRatio(valueOf(mode, 'done'), valueOf(mode, 'done-bg')),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('has AA contrast for a check that is still deferred', () => {
    expect(
      contrastRatio(valueOf(mode, 'text-muted'), valueOf(mode, 'pending-bg')),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('has AA contrast for the stages that wait, on a surface', () => {
    expect(
      contrastRatio(valueOf(mode, 'text-muted'), c.surface),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('has AA contrast for a check id on a surface', () => {
    expect(
      contrastRatio(valueOf(mode, 'text'), c.surface),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
