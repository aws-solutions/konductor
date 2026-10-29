// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inlineScriptsOf } from './inline-script.ts';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(
  html,
)?.[1];

const inlineScriptHashes = inlineScriptsOf(html).map(
  (body) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`,
);

describe('the Content-Security-Policy of index.html', () => {
  it('is exactly this policy, so a widened source or a new directive fails', () => {
    expect(policy?.split('; ')).toEqual([
      "default-src 'self'",
      ['script-src', "'self'", ...inlineScriptHashes].join(' '),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "base-uri 'none'",
      "form-action 'none'",
    ]);
  });
});
