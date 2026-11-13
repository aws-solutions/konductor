// SPDX-License-Identifier: Apache-2.0

const CODE_SPAN = /`([^`\n]+)`/gu;

/**
 * A message cut at each `name` in backticks: plain text at the even places and
 * the names, without their ticks, at the odd ones. A single backtick, or one
 * whose pair is on another line, stays in the text.
 */
export function messageParts(text: string): string[] {
  // Splitting on a group alternates plain text and the captured name.
  return text.split(CODE_SPAN);
}

/**
 * The message as plain text, for a place that cannot show code, such as a
 * live region or the reason of a button that is off: each name in backticks
 * loses its ticks, as `MessageText` shows it.
 */
export function plainText(text: string): string {
  return messageParts(text).join('');
}
