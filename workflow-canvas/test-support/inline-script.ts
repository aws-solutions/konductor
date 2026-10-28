// SPDX-License-Identifier: Apache-2.0

// Tag names are case-insensitive, a start tag may carry attributes, and an end
// tag may carry whitespace.
const SCRIPT = /<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi;

/** The body of the first `<script>` of the page that has one (an inline script). */
export function inlineScriptOf(html: string): string {
  for (const match of html.matchAll(SCRIPT)) {
    if ((match[1] ?? '').trim() !== '') return match[1] ?? '';
  }
  return '';
}
