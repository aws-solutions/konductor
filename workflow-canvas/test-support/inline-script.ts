// SPDX-License-Identifier: Apache-2.0

// Tag names are case-insensitive, a start tag may carry attributes, and an end
// tag may carry whitespace.
const SCRIPT = /<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi;

/** The bodies of the `<script>` tags of the page that have one (inline scripts). */
export function inlineScriptsOf(html: string): string[] {
  return [...html.matchAll(SCRIPT)]
    .map((match) => match[1] ?? '')
    .filter((body) => body.trim() !== '');
}

/** The body of the first inline script of the page, or '' if there is none. */
export function inlineScriptOf(html: string): string {
  return inlineScriptsOf(html)[0] ?? '';
}
