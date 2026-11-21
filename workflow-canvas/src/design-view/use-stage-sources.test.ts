// SPDX-License-Identifier: Apache-2.0
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DraftStage } from '../designer/core/draft';
import { useStageSources } from './use-stage-sources';

const FILE = 'stages:\n  - name: draft\n  - name: review\n';

const stage = (id: string, name: string): DraftStage => ({
  id,
  name,
  agent: 'k-developer',
});

const LOADED = [stage('s1', 'draft'), stage('s2', 'review')];

describe('useStageSources', () => {
  it('reads the place of each stage of the file it opened', () => {
    const { result } = renderHook(() =>
      useStageSources({ text: FILE, stages: LOADED }),
    );

    expect(result.current.of('s1')).toEqual({ kind: 'loaded', index: 0 });
    expect(result.current.of('s2')).toEqual({ kind: 'loaded', index: 1 });
  });

  it('keeps those places through a rename, an add and a delete', () => {
    const { result, rerender } = renderHook(
      ({ stages }: { stages: readonly DraftStage[] }) =>
        useStageSources({ text: FILE, stages }),
      { initialProps: { stages: LOADED } },
    );

    // The first stage is deleted, the second renamed, and one added: nothing
    // of the draft still says where the second came from.
    rerender({
      stages: [stage('s2', 'reviewing'), stage('s3', 'agent-3')],
    });

    expect(result.current.of('s2')).toEqual({ kind: 'loaded', index: 1 });
    expect(result.current.of('s3')).toEqual({ kind: 'added' });
  });

  it('counts a stage the file never had as added', () => {
    const { result } = renderHook(() =>
      useStageSources({ text: FILE, stages: LOADED }),
    );

    expect(result.current.of('s9')).toEqual({ kind: 'added' });
  });

  it('reads the places again for another file, as a save or a reload gives', () => {
    const { result, rerender } = renderHook(
      ({ text, stages }: { text: string; stages: readonly DraftStage[] }) =>
        useStageSources({ text, stages }),
      { initialProps: { text: FILE, stages: LOADED } },
    );

    // The file saved has the stages of the draft that saved it, in its order.
    const saved = [stage('s2', 'reviewing'), stage('s3', 'agent-3')];
    rerender({ text: `${FILE}  - name: agent-3\n`, stages: saved });

    expect(result.current.of('s2')).toEqual({ kind: 'loaded', index: 0 });
    expect(result.current.of('s3')).toEqual({ kind: 'loaded', index: 1 });
    expect(result.current.of('s1')).toEqual({ kind: 'added' });
  });
});
