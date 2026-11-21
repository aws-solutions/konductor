// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { freshMemory } from '../test-support/memory-storage';
import { forgetIfStill } from './session-forget';

const recordOf = (token: string) => ({ token, harness: 'kiro-cli' });

describe('forgetIfStill', () => {
  it('drops the kept session when its own call is answered with 401', () => {
    const memory = freshMemory();
    memory.remember(recordOf('token-1'));

    forgetIfStill(memory, 'token-1')();

    expect(memory.recall()).toBeUndefined();
  });

  it('keeps the newer session when an old call is answered with 401', () => {
    // The person pasted another launch address: its session loaded and was
    // kept, and a call of the workflow it replaced is still out.
    const memory = freshMemory();
    memory.remember(recordOf('token-2'));

    forgetIfStill(memory, 'token-1')();

    expect(memory.recall()).toEqual(recordOf('token-2'));
  });

  it('drops the pending session of the token that failed', () => {
    const memory = freshMemory();
    memory.remember(recordOf('token-1'));
    memory.holdPending(recordOf('token-2'));

    forgetIfStill(memory, 'token-2')();

    expect(memory.recall()).toEqual(recordOf('token-1'));
    expect(memory.recallPending()).toBeUndefined();
  });

  it('keeps a pending session that is not the one that failed', () => {
    const memory = freshMemory();
    memory.holdPending(recordOf('token-2'));

    forgetIfStill(memory, 'token-1')();

    expect(memory.recallPending()).toEqual(recordOf('token-2'));
  });

  it('drops nothing for calls that never had a session', () => {
    const memory = freshMemory();
    memory.remember(recordOf('token-1'));

    forgetIfStill(memory, undefined)();

    expect(memory.recall()).toEqual(recordOf('token-1'));
  });
});
