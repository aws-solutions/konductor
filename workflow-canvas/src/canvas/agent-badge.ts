// SPDX-License-Identifier: Apache-2.0

/** The number of deterministic agent badge colours. */
export const AGENT_BADGE_COLORS = 8;

/** Two letters derived from an agent id for its card badge. */
export function agentInitials(agentId: string): string {
  const words = agentId
    .replace(/^k-/, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  if (words.length >= 2) {
    const first = words[0] ?? '';
    const second = words[1] ?? '';
    return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
  }
  const word = words[0] ?? '?';
  const initials = word.length === 1 ? word.repeat(2) : word.slice(0, 2);
  return initials.toUpperCase();
}

/** A stable palette index derived from the full agent id. */
export function agentColor(agentId: string): number {
  let hash = 0;
  for (const character of agentId) {
    const codePoint = character.codePointAt(0) ?? 0;
    hash = (hash * 31 + codePoint) % AGENT_BADGE_COLORS;
  }
  return hash;
}
