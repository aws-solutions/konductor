// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const stylesDir = createRequire(import.meta.url)
  .resolve('@cloudscape-design/global-styles/index-base.css')
  .replace(/index-base\.css$/, '');

// The page sets every font token to its own faces (see src/theme/tokens.ts),
// so the Open Sans faces that `index.css` embeds would only add weight.
describe('the global styles of Cloudscape', () => {
  it('are imported without the Open Sans faces', () => {
    expect(main).toContain('@cloudscape-design/global-styles/index-base.css');
    expect(main).not.toMatch(/global-styles\/index\.css/);
  });

  it('hold no font face in the base file', () => {
    const base = readFileSync(`${stylesDir}index-base.css`, 'utf8');

    expect(base).not.toContain('@font-face');
  });
});
