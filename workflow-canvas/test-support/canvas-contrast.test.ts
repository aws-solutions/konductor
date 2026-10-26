// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AA_GRAPHIC, AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';
import { colorsOf, RADIUS, type ThemeMode } from '../src/theme/tokens.ts';

const css = readFileSync(
  new URL('../src/canvas/canvas.css', import.meta.url),
  'utf8',
);

// The declarations of the rule that starts with `selector`.
function block(selector: string): string {
  return css.split(`${selector} {`)[1]?.split('}')[0] ?? '';
}

function variables(selector: string): Record<string, string> {
  return Object.fromEntries(
    [...block(selector).matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [
      m[1],
      m[2],
    ]),
  );
}

const light = variables('.wf-canvas');
const dark = { ...light, ...variables(":root[data-theme='dark'] .wf-canvas") };
const MODES: [ThemeMode, Record<string, string>][] = [
  ['light', light],
  ['dark', dark],
];

const RUN_STATES = ['queued', 'running', 'done', 'failed'] as const;

describe.each(MODES)('canvas.css colours in %s', (mode, v) => {
  const ratio = (a: string, b: string) => contrastRatio(v[a]!, v[b]!);

  it('keeps the canvas text readable', () => {
    expect(ratio('--wf-text', '--wf-node-bg')).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio('--wf-text-muted', '--wf-node-bg')).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(ratio('--wf-text-muted', '--wf-canvas-bg')).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(ratio('--wf-text', '--wf-controls-bg')).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('keeps nodes, edges and the focus ring visible', () => {
    for (const name of ['--wf-node-border', '--wf-edge', '--wf-focus']) {
      expect(ratio(name, '--wf-canvas-bg')).toBeGreaterThanOrEqual(AA_GRAPHIC);
    }
  });

  it('keeps the port letters readable on their ports', () => {
    expect(
      ratio('--wf-port-letter-out', '--wf-port-fill'),
    ).toBeGreaterThanOrEqual(AA_TEXT);
    // The notch is white inside, and its letter is a dark gray.
    expect(
      ratio('--wf-port-letter-in', '--wf-port-notch-bg'),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps the tab visible on the canvas and on the node', () => {
    expect(ratio('--wf-port-fill', '--wf-canvas-bg')).toBeGreaterThanOrEqual(
      AA_GRAPHIC,
    );
    expect(ratio('--wf-port-fill', '--wf-node-bg')).toBeGreaterThanOrEqual(
      AA_GRAPHIC,
    );
  });

  it('keeps the card outline visible on the canvas and on the node', () => {
    expect(ratio('--wf-node-border', '--wf-canvas-bg')).toBeGreaterThanOrEqual(
      AA_GRAPHIC,
    );
    expect(ratio('--wf-node-border', '--wf-node-bg')).toBeGreaterThanOrEqual(
      AA_GRAPHIC,
    );
  });

  it.each(RUN_STATES)(
    'keeps the %s state readable in its badge and visible as an outline',
    (state) => {
      const color = `--wf-state-${state}`;
      expect(ratio(color, `${color}-bg`)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(ratio(color, '--wf-canvas-bg')).toBeGreaterThanOrEqual(AA_GRAPHIC);
      expect(ratio(color, '--wf-node-bg')).toBeGreaterThanOrEqual(AA_GRAPHIC);
    },
  );

  it('uses the colours of the theme module', () => {
    const c = colorsOf(mode);

    expect(v['--wf-canvas-bg']).toBe(c.bg);
    expect(v['--wf-node-bg']).toBe(c.surface);
    expect(v['--wf-node-border']).toBe(c.control);
    expect(v['--wf-text']).toBe(c.text);
    expect(v['--wf-text-muted']).toBe(c.textMuted);
    expect(v['--wf-focus']).toBe(c.link);
    expect(v['--wf-controls-bg']).toBe(c.surface);
    expect(v['--wf-controls-border']).toBe(c.borderStrong);
    expect(v['--wf-controls-bg-hover']).toBe(c.infoBg);
    expect(v['--wf-state-queued']).toBe(c.textMuted);
    expect(v['--wf-state-queued-bg']).toBe(c.surfaceAlt);
    expect(v['--wf-state-running']).toBe(c.link);
    expect(v['--wf-state-running-bg']).toBe(c.infoBg);
    expect(v['--wf-state-done']).toBe(c.success);
    expect(v['--wf-state-done-bg']).toBe(c.successBg);
    expect(v['--wf-state-failed']).toBe(c.error);
    expect(v['--wf-state-failed-bg']).toBe(c.errorBg);
  });
});

describe('canvas.css shapes', () => {
  it('uses the radius of the theme module for the canvas', () => {
    expect(block('.wf-canvas')).toContain(`border-radius: ${RADIUS.card}`);
  });
});
