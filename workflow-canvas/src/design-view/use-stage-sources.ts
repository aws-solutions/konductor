// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef } from 'react';
import type { Draft, DraftStage } from '../designer/core/draft';
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

// A draft the editor built afresh from a file, rather than one edited from
// the draft the places were read from. The editor hands out stage ids in one
// rising sequence for the life of a draft, so an edited draft never has a
// lower `nextId` than the draft it came from, while a draft built from a file
// starts again at one past that file's stage count.
function isRebuilt(nextId: number, takenAt: number): boolean {
  return nextId < takenAt;
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
 * or a save gives, is read again from the draft the editor built for it.
 * `text` is what `useInitialCheck` reads, so the places and the keys of the
 * stages are always of the same file.
 *
 * The same text can also arrive with a draft built afresh, when the file is
 * loaded again while this hook stays mounted. Its ids start over, so the
 * places of the draft before it would name the wrong stages and read a stage
 * the file does have as added, which the save guard lets through. The draft's
 * `nextId` tells the two apart, so a rebuilt draft always retakes the places
 * from position.
 */
export function useStageSources({
  text,
  draft,
  submitted,
}: {
  /** The text of the file as it was loaded. */
  readonly text: string;
  /** The draft now, with the stages in order and the next id it will hand out. */
  readonly draft: Draft;
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
  //
  // The end of the save drops them, after the render that installed them for
  // a save that worked. A save that ended without its text becoming the file,
  // as a refusal or a conflict does, leaves nothing behind: the file a later
  // load brings has a draft of its own, with its own ids, and the places of
  // the draft that was sent would say nothing about it even when the text it
  // holds is the same.
  const sent = useRef<{ text: string; places: Places; nextId: number }>(
    undefined,
  );
  const drafted = useRef(draft);
  useEffect(() => {
    drafted.current = draft;
  });
  useEffect(() => {
    const made = drafted.current;
    sent.current =
      submitted === undefined
        ? undefined
        : {
            text: submitted,
            places: placesOf(made.stages),
            nextId: made.nextId,
          };
  }, [submitted]);

  // Taken in the render, not in an effect: the places must be there in the
  // first render of a file, before anything reads a stage. Reading the same
  // file again gives the same places, so a render React throws away leaves
  // nothing behind.
  const taken = useRef<{ text: string; places: Places; nextId: number }>(
    undefined,
  );
  if (
    taken.current === undefined ||
    taken.current.text !== text ||
    isRebuilt(draft.nextId, taken.current.nextId)
  ) {
    const held = sent.current;
    const fromSave = held?.text === text ? held : undefined;
    taken.current = fromSave ?? {
      text,
      places: placesOf(draft.stages),
      nextId: draft.nextId,
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
