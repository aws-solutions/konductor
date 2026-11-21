// SPDX-License-Identifier: Apache-2.0
import { useRef } from 'react';
import type { DraftStage } from '../designer/core/draft';
import type { StageSource } from './view-stage';

const ADDED: StageSource = { kind: 'added' };

/**
 * Where each stage of the draft came from in the file, by the editor's own
 * stage id.
 */
export interface StageSources {
  /** The source of the stage with this id; a stage added since has none. */
  of(id: string): StageSource;
}

function sourcesOf(stages: readonly DraftStage[]): ReadonlyMap<string, number> {
  return new Map(stages.map((stage, index) => [stage.id, index]));
}

/**
 * Where each stage of the draft came from in the file, for as long as that
 * file is the one being edited.
 *
 * The places are read once, from the draft as the editor opens a file: the
 * draft is then the stages of the file, in its order. The editor keeps a
 * stage's id through a rename, an add and a delete, so the id goes on naming
 * the place the stage was loaded from however the draft is edited after that,
 * which neither its name nor its current position does. A stage whose id was
 * not there when the file was read was added since, and the file has no stage
 * for it.
 *
 * `text` is the file the places belong to. A new one, as another workflow, a
 * reload or a save gives, is read again: the editor builds its draft from the
 * stages of that file, so the two are in step again. `text` is what
 * `useInitialCheck` reads, so the places and the keys of the stages are
 * always of the same file.
 */
export function useStageSources({
  text,
  stages,
}: {
  /** The text of the file as it was loaded. */
  readonly text: string;
  /** The stages of the draft, in the render that first has this text. */
  readonly stages: readonly DraftStage[];
}): StageSources {
  // Taken in the render, not in an effect: the places must be those of the
  // draft that opened this text, and an effect would first let a render pass
  // with the places of the file before it. Reading the same text again gives
  // the same places, so a render that React throws away leaves nothing behind.
  const taken = useRef<{
    readonly text: string;
    readonly sources: ReadonlyMap<string, number>;
  }>(undefined);
  if (taken.current?.text !== text) {
    taken.current = { text, sources: sourcesOf(stages) };
  }
  const { sources } = taken.current;
  return {
    of: (id) => {
      const index = sources.get(id);
      return index === undefined ? ADDED : { kind: 'loaded', index };
    },
  };
}
