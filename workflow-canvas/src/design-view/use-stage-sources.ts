// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef } from 'react';
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

type Places = ReadonlyMap<string, number>;

function placesOf(stages: readonly DraftStage[]): Places {
  return new Map(stages.map((stage, index) => [stage.id, index]));
}

/**
 * Where each stage of the draft came from in the file, for as long as that
 * file is the one being edited.
 *
 * The places are read from the draft that made the file: the stages of a file
 * the editor has just opened are its draft, in its order. The editor keeps a
 * stage's id through a rename, an add and a delete, so the id goes on naming
 * the place the stage was loaded from however the draft is edited after that,
 * which neither its name nor its current position does. A stage whose id was
 * not there when the file was read was added since, and the file has no stage
 * for it.
 *
 * A save is the one case where the file arrives after the draft that made it
 * has moved on, because the editor takes edits while a save is in flight and
 * keeps them when the answer comes. So the places of the submitted draft are
 * held from the moment the save starts, and installed when its text becomes
 * the file. Without that, a stage would take the place it holds in the newer
 * draft, which is another stage of the file it was saved into.
 *
 * `text` is the file the places belong to. Another one, as another workflow
 * or a reload gives, is read again from the draft the editor built for it.
 * `text` is what `useInitialCheck` reads, so the places and the keys of the
 * stages are always of the same file.
 */
export function useStageSources({
  text,
  stages,
  submitted,
}: {
  /** The text of the file as it was loaded. */
  readonly text: string;
  /** The stages of the draft now. */
  readonly stages: readonly DraftStage[];
  /**
   * The text a save has in flight, which is about to become the file, or
   * `undefined` when no save is going on.
   */
  readonly submitted?: string;
}): StageSources {
  // Held in an effect, so the places are those of the draft that was
  // submitted, not of a draft edited while the save was in flight. The
  // effect of a save runs before any answer to it can arrive, and it runs
  // again only for another save, so a later edit leaves the places alone.
  const sent = useRef<{ text: string; places: Places }>(undefined);
  const drafted = useRef(stages);
  useEffect(() => {
    drafted.current = stages;
  });
  useEffect(() => {
    if (submitted !== undefined) {
      sent.current = { text: submitted, places: placesOf(drafted.current) };
    }
  }, [submitted]);

  // Taken in the render, not in an effect: the places must be there in the
  // first render of a file, before anything reads a stage. Reading the same
  // file again gives the same places, so a render React throws away leaves
  // nothing behind.
  const taken = useRef<{ text: string; places: Places }>(undefined);
  if (taken.current?.text !== text) {
    const held = sent.current;
    taken.current = {
      text,
      places: held?.text === text ? held.places : placesOf(stages),
    };
  }
  const { places } = taken.current;
  return {
    of: (id) => {
      const index = places.get(id);
      return index === undefined ? ADDED : { kind: 'loaded', index };
    },
  };
}
