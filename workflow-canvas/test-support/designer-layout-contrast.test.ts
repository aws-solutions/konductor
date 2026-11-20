// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AA_GRAPHIC, AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';
import { colorsOf, RADIUS, type ThemeMode } from '../src/theme/tokens.ts';
import { COLOUR_LITERAL, HEX_COLOUR, readStyleSheet } from './css-variables.ts';

const sheet = readStyleSheet(
  new URL('../src/designer-view/designer-layout.css', import.meta.url),
);
const LIGHT_BLOCK = '.wf-layout';
const DARK_BLOCK = ":root[data-theme='dark'] .wf-layout";

const light = sheet.declarations(LIGHT_BLOCK);

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

// The index of the brace that closes the block whose opening brace is the
// first one in `text`.
function closingOf(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

function narrowBlock(): string {
  const code = withoutComments(sheet.text);
  const rest = code.slice(code.indexOf('@media (max-width: 900px)'));
  return rest.slice(rest.indexOf('{') + 1, closingOf(rest));
}

// Each rule of `text`, as its selector and the properties it sets.
function rulesOf(text: string): [string, string[]][] {
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => [
    match[1]!.trim().replace(/\s+/g, ' '),
    [...match[2]!.matchAll(/([\w-]+)\s*:/g)].map((p) => p[1]!),
  ]);
}

function declarationsOf(block: string): [string, string][] {
  return rulesOf(block).flatMap(([selector, props]) =>
    selector
      .split(',')
      .flatMap((one) =>
        props.map((prop): [string, string] => [one.trim(), prop]),
      ),
  );
}
const MODES: [ThemeMode, Record<string, string>][] = [
  ['light', light],
  ['dark', { ...light, ...sheet.declarations(DARK_BLOCK) }],
];

describe.each(MODES)('designer-layout.css colours in %s', (mode, v) => {
  const ratio = (a: string, b: string) => contrastRatio(v[a]!, v[b]!);

  it('keeps the tabs, the fold button and the notes readable', () => {
    for (const text of ['--wf-layout-text', '--wf-layout-text-muted']) {
      expect(ratio(text, '--wf-layout-bg'), text).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    }
  });

  it('keeps the edges, the selected tab mark and the focus ring visible', () => {
    for (const part of [
      '--wf-layout-edge',
      '--wf-layout-selected',
      '--wf-layout-focus',
    ]) {
      expect(ratio(part, '--wf-layout-bg'), part).toBeGreaterThanOrEqual(
        AA_GRAPHIC,
      );
    }
  });

  it('uses the colours of the theme module, and names every one it uses', () => {
    const c = colorsOf(mode);

    expect(v).toEqual({
      '--wf-layout-bg': c.surface,
      '--wf-layout-border': c.border,
      '--wf-layout-text': c.text,
      '--wf-layout-text-muted': c.textMuted,
      '--wf-layout-edge': c.control,
      '--wf-layout-selected': c.link,
      '--wf-layout-focus': c.link,
    });
  });
});

describe('designer-layout.css', () => {
  it('declares its colours as 6-digit hex in the two variable blocks only', () => {
    for (const selector of [LIGHT_BLOCK, DARK_BLOCK]) {
      for (const [name, value] of Object.entries(
        sheet.declarations(selector),
      )) {
        expect(value, name).toMatch(HEX_COLOUR);
      }
    }
    expect(sheet.outside(LIGHT_BLOCK)).not.toMatch(COLOUR_LITERAL);
  });

  it('uses the small radius of the theme module, and no smooth scrolling', () => {
    expect(sheet.text).toContain(`border-radius: ${RADIUS.small}`);
    expect(sheet.text).not.toMatch(/scroll-behavior:\s*smooth/);
  });

  it('stacks the columns below 900 pixels, as the Designer does, in the order of the page', () => {
    const designer = readStyleSheet(
      new URL('../src/designer/designer.css', import.meta.url),
    ).text;

    expect(designer).toContain('@media (max-width: 900px)');
    expect(narrowBlock()).toMatch(
      /\.wf-layout,\s*\.wf-layout\[data-folded='true'\] \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(narrowBlock()).not.toMatch(/display: none/);
  });

  it('reorders nothing, so the visual order is the keyboard order', () => {
    const code = withoutComments(sheet.text);

    expect(code).not.toMatch(/(^|[\s;{])order\s*:/m);
    expect(code).not.toMatch(/grid-(row|column|area)\s*:/);
    expect(code).not.toMatch(/-reverse/);
  });

  it('puts the narrow block last, so no later rule undoes one of its declarations', () => {
    const code = withoutComments(sheet.text);
    const at = code.indexOf('@media (max-width: 900px)');
    const rest = code.slice(at + '@media (max-width: 900px)'.length);

    expect(at).toBeGreaterThan(0);
    expect(rest.slice(closingOf(rest) + 1).trim()).toBe('');
    for (const [selector, property] of declarationsOf(narrowBlock())) {
      const later = rulesOf(rest.slice(closingOf(rest) + 1)).filter(
        ([other, props]) => other === selector && props.includes(property),
      );
      expect(later, `${selector} ${property}`).toEqual([]);
    }
  });

  it('marks the selected tab and the focus with system colours in forced-colors mode', () => {
    expect(sheet.text).toMatch(
      /@media \(forced-colors: active\) \{[\s\S]*Highlight/,
    );
  });
});
