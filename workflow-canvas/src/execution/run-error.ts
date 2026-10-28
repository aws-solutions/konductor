// SPDX-License-Identifier: Apache-2.0
import type { ExecutionState } from './core';

/** What the person is told when a run could not start or be followed. */
export interface RunErrorText {
  header: string;
  /** The sentence of the server or the page. */
  message: string;
  /** Said after a failure to follow: the run itself may be going on. */
  note?: string;
}

/** The words for the error of a run, or `undefined` when there is none. */
export function runErrorOf(state: ExecutionState): RunErrorText | undefined {
  if (state.phase !== 'error') return undefined;
  if (!state.started) {
    return { header: 'The run did not start', message: state.message };
  }
  const which = state.runId === undefined ? '' : ` (run ${state.runId})`;
  return {
    header: 'The run could not be followed',
    message: state.message,
    note: `The run may still be going on the server${which}.`,
  };
}

const withStop = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** The error as one run of sentences for a screen reader, or an empty string. */
export function runErrorSentence(state: ExecutionState): string {
  const error = runErrorOf(state);
  if (!error) return '';
  return [error.header, error.message, error.note]
    .filter((part): part is string => part !== undefined)
    .map(withStop)
    .join(' ');
}
