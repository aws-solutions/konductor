// SPDX-License-Identifier: Apache-2.0
import type { SessionMemory } from '../launch/session-memory';

/**
 * What a 401 of one session does to the session the page keeps: it drops it,
 * and only while the token that failed is still the one kept.
 *
 * The calls of a workflow outlive the workflow on the page. A person who
 * pastes another launch address gets a new session, which is kept as soon as
 * it loads, while a call of the workflow that was left can still be out; its
 * 401 says nothing about the session now kept, so dropping that one would
 * leave the page working until a reload and unable to come back after it.
 * This is the rule the loader follows for the calls it guards.
 */
export function forgetIfStill(
  memory: SessionMemory,
  token: string | undefined,
): () => void {
  return () => {
    if (token === undefined) return;
    if (memory.recall()?.token === token) memory.forget();
    if (memory.recallPending()?.token === token) memory.dropPending();
  };
}
