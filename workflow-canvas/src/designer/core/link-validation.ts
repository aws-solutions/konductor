// SPDX-License-Identifier: Apache-2.0
import type { Draft } from './draft';
import { outputNameError } from './outputs-text';

const STAGE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESERVED_STAGE_NAMES = new Set(['start', 'end', 'run', 'halt']);

export const PATH_ERROR =
  'Use a relative path inside the project, with / between its parts.';

export function pathValueError(path: string): string | undefined {
  if (
    path === '' ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.includes('\\') ||
    /[\u0000-\u001F\u007F-\u009F]/.test(path) ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    return PATH_ERROR;
  }
  return undefined;
}

/** Why a stage name cannot become the scope of a prompt reference. */
export function linkSourceNameError(
  draft: Draft,
  sourceId: string,
): string | undefined {
  const source = draft.stages.find(({ id }) => id === sourceId);
  if (!source) return 'The source stage no longer exists.';
  if (!STAGE_NAME.test(source.name)) {
    return 'Fix the source stage name before linking its output.';
  }
  if (RESERVED_STAGE_NAMES.has(source.name)) {
    return 'A reserved stage name cannot be used in an output link.';
  }
  if (draft.stages.filter(({ name }) => name === source.name).length > 1) {
    return 'Stage names must be unique before linking an output.';
  }
  return undefined;
}

/** Why output values cannot be used in a prompt reference. */
export function outputLinkValueError(
  name: string,
  path: string,
): string | undefined {
  return outputNameError(name) ?? pathValueError(path);
}

/** Why one existing output cannot be referenced from a prompt. */
export function declaredOutputLinkError(
  draft: Draft,
  sourceId: string,
  outputName: string,
): string | undefined {
  const source = draft.stages.find(({ id }) => id === sourceId);
  const output = source?.outputs?.find(({ name }) => name === outputName);
  if (!output) return 'The selected output no longer exists.';
  return outputLinkValueError(output.name, output.path);
}
