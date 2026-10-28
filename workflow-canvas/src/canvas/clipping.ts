// SPDX-License-Identifier: Apache-2.0
import type { StageSpec, WorkflowSpec } from '../graph';

/**
 * How much text one line of a node holds, in `textWidth` units. The intent
 * node wraps its outcome onto three lines; a stage shows its name on one line
 * and its agent and harness on another.
 */
export const INTENT_FITS_IN_NODE = 90;
export const NAME_FITS_IN_NODE = 24;
export const AGENT_LINE_FITS_IN_NODE = 30;

const WIDE =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;
const UPPER = /\p{Lu}/u;

/**
 * How wide `text` is drawn, in units of one lower case Latin letter. CJK and
 * emoji count 2 and capitals 1.3, so a count of characters does not tell what
 * fits in a node, and this does.
 */
export function textWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (WIDE.test(char)) width += 2;
    else if (UPPER.test(char)) width += 1.3;
    else width += 1;
  }
  return width;
}

/** The stages of `view` whose name or agent line a node cuts short. */
export function clippedStages(
  view: WorkflowSpec,
  harness: string,
): StageSpec[] {
  return view.stages.filter(
    ({ name, agent }) =>
      textWidth(name) > NAME_FITS_IN_NODE ||
      textWidth(`${agent} · ${harness}`) > AGENT_LINE_FITS_IN_NODE,
  );
}
