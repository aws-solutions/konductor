// SPDX-License-Identifier: Apache-2.0
import {
  MAX_PROMPT_CHARS,
  NAME_PATTERN,
  PATH_PATTERN_SOURCE,
  RESERVED_STAGE_NAMES,
} from './contract.ts';
import type { StageField, StageFields } from './model.ts';

// A name has a first character and up to 63 more, as NAME_PATTERN says.
const MAX_NAME_CHARS = 64;

const nameField = (key: string): StageField => ({
  key,
  type: 'name',
  required: true,
  max_length: MAX_NAME_CHARS,
  pattern: NAME_PATTERN.source,
});

/** The keys of a stage that a person edits, by kind, as `GET /api/workflow` reports them. */
export const STAGE_FIELDS: StageFields = {
  agent: [
    { ...nameField('name'), reserved: [...RESERVED_STAGE_NAMES] },
    nameField('agent'),
    {
      key: 'prompt',
      type: 'text',
      required: false,
      min_length: 1,
      max_length: MAX_PROMPT_CHARS,
      excludes: ['prompt_file'],
    },
    {
      key: 'prompt_file',
      type: 'path',
      required: false,
      pattern: PATH_PATTERN_SOURCE,
      excludes: ['prompt'],
    },
    {
      key: 'outcome',
      type: 'text',
      required: false,
      min_length: 1,
      max_length: 300,
      pattern: '^[^\\r\\n]*$',
    },
  ],
};
