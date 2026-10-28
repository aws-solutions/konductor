// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inlineScriptOf } from './inline-script.ts';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(
  html,
)?.[1];

describe('the Content-Security-Policy of index.html', () => {
  it('lets the page run its own files and nothing from another origin', () => {
    expect(policy).toMatch(/^default-src 'self';/);
    expect(policy).not.toMatch(
      /https?:|\*|unsafe-eval|script-src[^;]*unsafe-inline/,
    );
  });

  it('allows the inline script by the hash of its exact text', () => {
    const hash = createHash('sha256')
      .update(inlineScriptOf(html))
      .digest('base64');

    expect(policy).toContain(`script-src 'self' 'sha256-${hash}'`);
  });
});
