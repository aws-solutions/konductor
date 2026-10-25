// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AA_GRAPHIC, AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';

const css = readFileSync(
  new URL('../src/canvas/canvas.css', import.meta.url),
  'utf8',
);

describe('canvas.css colours', () => {
  // The declarations of the rule that starts with `selector`.
  function variables(selector: string): Record<string, string> {
    const block = css.split(`${selector} {`)[1]?.split('}')[0] ?? '';
    return Object.fromEntries(
      [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [
        m[1],
        m[2],
      ]),
    );
  }

  const light = variables('.wf-canvas');
  const dark = { ...light, ...variables('.awsui-dark-mode .wf-canvas') };

  it.each([
    ['light', light],
    ['dark', dark],
  ])('keeps the canvas text readable in %s', (_mode, v) => {
    expect(
      contrastRatio(v['--wf-text']!, v['--wf-node-bg']!),
    ).toBeGreaterThanOrEqual(AA_TEXT);
    expect(
      contrastRatio(v['--wf-text-muted']!, v['--wf-node-bg']!),
    ).toBeGreaterThanOrEqual(AA_TEXT);
    expect(
      contrastRatio(v['--wf-text-muted']!, v['--wf-canvas-bg']!),
    ).toBeGreaterThanOrEqual(AA_TEXT);
    expect(
      contrastRatio(v['--wf-text']!, v['--wf-controls-bg']!),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each([
    ['light', light],
    ['dark', dark],
  ])('keeps nodes, edges and the focus ring visible in %s', (_mode, v) => {
    for (const name of ['--wf-node-border', '--wf-edge', '--wf-focus']) {
      expect(
        contrastRatio(v[name]!, v['--wf-canvas-bg']!),
      ).toBeGreaterThanOrEqual(AA_GRAPHIC);
    }
  });

  it('keeps the port letters readable on their ports', () => {
    expect(
      contrastRatio(light['--wf-port-letter-out']!, light['--wf-port-fill']!),
    ).toBeGreaterThanOrEqual(AA_TEXT);
    expect(
      contrastRatio(light['--wf-port-letter-in']!, light['--wf-port-inner']!),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
