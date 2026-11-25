// SPDX-License-Identifier: Apache-2.0

// A value that a plain YAML scalar reads back as the same text: it starts
// with a letter, has no character that YAML gives a meaning, and does not end
// in a space. Words that YAML 1.1 reads as booleans or null are left out, so
// an editor on that version reads the same text.
const PLAIN = /^[A-Za-z](?:[A-Za-z0-9 _.,()/-]*[A-Za-z0-9_.,()/-])?$/;
const NOT_TEXT = /^(?:true|false|null|y|n|yes|no|on|off)$/i;

// Characters that JSON leaves as they are and YAML does not take raw, so they
// are written as escapes that JSON reads too. U+007F and U+0080 to U+009F are
// not printable in YAML. U+0085, U+2028 and U+2029 are also line breaks to
// YAML 1.1, which fold inside double quotes (libyaml reads U+0085 there as a
// space). The byte order mark and the two code points that are not characters
// are escaped too, so no reader takes them for something else.
const ESCAPED = /[\u007F-\u009F\u2028\u2029\uFEFF\uFFFE\uFFFF]/gu;

/** The value as a double-quoted YAML scalar, which JSON reads the same way. */
export function quoted(value: string): string {
  return JSON.stringify(value).replace(
    ESCAPED,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** The value as YAML text: plain when that is safe, double-quoted if not. */
export function scalar(value: string): string {
  return PLAIN.test(value) && !NOT_TEXT.test(value) ? value : quoted(value);
}
