// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';
import { AGENT_BADGES, WHITE, type ThemeMode } from '../src/theme/tokens.ts';
import { readStyleSheet } from './css-variables.ts';

const palette = readStyleSheet(
  new URL('../src/theme/agent-badges.css', import.meta.url),
).declarations(':root');
const card = readStyleSheet(
  new URL('../src/canvas/canvas.css', import.meta.url),
).text;
const tray = readStyleSheet(
  new URL('../src/designer-view/components-tray.css', import.meta.url),
).text;

for (const mode of ['light', 'dark'] as const satisfies readonly ThemeMode[]) {
  describe(`agent badge palette in ${mode}`, () => {
    it('keeps every tray and card badge readable', () => {
      expect(palette['--wf-agent-text']).toBe(WHITE);
      for (const [index, color] of AGENT_BADGES.entries()) {
        expect(palette[`--wf-agent-${index}`]).toBe(color);
        expect(contrastRatio(WHITE, color)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(card).toContain(`background: var(--wf-agent-${index})`);
        expect(tray).toContain(
          `--wf-component-color: var(--wf-agent-${index})`,
        );
      }
    });
  });
}
