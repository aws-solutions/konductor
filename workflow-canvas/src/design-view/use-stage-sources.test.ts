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

/** What the view knows: the file it loaded, its draft, and a save in flight. */
interface Editing {
  text: string;
  stages: readonly DraftStage[];
  submitted?: string;
}

const editing = (first: Editing) =>
  renderHook((props: Editing) => useStageSources(props), {
    initialProps: first,
  });

describe('useStageSources', () => {
  it('reads the place of each stage of the file it opened', () => {
    const { result } = editing({ text: FILE, stages: LOADED });

    expect(result.current.of('s1')).toEqual({ kind: 'loaded', index: 0 });
    expect(result.current.of('s2')).toEqual({ kind: 'loaded', index: 1 });
  });

  it('keeps those places through a rename, an add and a delete', () => {
    const { result, rerender } = editing({ text: FILE, stages: LOADED });

    // The first stage is deleted, the second renamed, and one added: nothing
    // of the draft still says where the second came from.
    rerender({
      text: FILE,
      stages: [stage('s2', 'reviewing'), stage('s3', 'agent-3')],
    });

    expect(result.current.of('s2')).toEqual({ kind: 'loaded', index: 1 });
    expect(result.current.of('s3')).toEqual({ kind: 'added' });
  });

  it('counts a stage the file never had as added', () => {
    const { result } = editing({ text: FILE, stages: LOADED });

    expect(result.current.of('s9')).toEqual({ kind: 'added' });
  });

  it('reads the places again for another file, as a reload gives', () => {
    const { result, rerender } = editing({ text: FILE, stages: LOADED });

    // A reload builds a fresh draft from the stages of the file on disk.
    rerender({
      text: `${FILE}  - name: agent-3\n`,
      stages: [stage('s1', 'draft'), stage('s2', 'review')],
    });

    expect(result.current.of('s1')).toEqual({ kind: 'loaded', index: 0 });
    expect(result.current.of('s2')).toEqual({ kind: 'loaded', index: 1 });
  });

  it('keeps the places of the draft a save submitted, not of one edited since', () => {
    const SENT = 'sent.yml';
    const { result, rerender } = editing({ text: FILE, stages: LOADED });

    // The save goes out with both stages, so the file it writes has review
    // in the second place.
    rerender({ text: FILE, stages: LOADED, submitted: SENT });
    // The person deletes the first stage while the save is in flight; the
    // editor keeps that edit when the answer comes.
    const left = [stage('s2', 'review')];
    rerender({ text: FILE, stages: left, submitted: SENT });
    // The answer arrives, and the text it wrote becomes the file.
    rerender({ text: SENT, stages: left });

    expect(result.current.of('s2')).toEqual({ kind: 'loaded', index: 1 });
  });

  it('reads the places of the newer draft when a save of another text lands', () => {
    const { result, rerender } = editing({ text: FILE, stages: LOADED });

    rerender({ text: FILE, stages: LOADED, submitted: 'sent.yml' });
    // The save failed and the file was loaded again instead, so the text
    // that arrives is not the one that was sent.
    rerender({ text: 'disk.yml', stages: [stage('s2', 'review')] });

    expect(result.current.of('s2')).toEqual({ kind: 'loaded', index: 0 });
  });

  it('holds the places of each save, so a second save of the same text is its own', () => {
    const SENT = 'sent.yml';
    const { result, rerender } = editing({ text: FILE, stages: LOADED });

    rerender({ text: FILE, stages: LOADED, submitted: SENT });
    // That save failed, the person deleted the first stage, and the same
    // text went out again from the draft as it is now.
    const left = [stage('s2', 'review'), stage('s3', 'agent-3')];
    rerender({ text: FILE, stages: left });
    rerender({ text: FILE, stages: left, submitted: SENT });
    rerender({ text: SENT, stages: left });

    expect(result.current.of('s2')).toEqual({ kind: 'loaded', index: 0 });
    expect(result.current.of('s3')).toEqual({ kind: 'loaded', index: 1 });
  });
});
