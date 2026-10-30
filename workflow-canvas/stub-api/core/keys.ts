// SPDX-License-Identifier: Apache-2.0

/**
 * A slice is a unit of delivery of the workflow format. Each key belongs to
 * exactly one, in the order below, and a build reads the keys up to its own.
 */
export const SLICES = [
  '1',
  '2',
  '3a',
  '3b',
  '4',
  '5',
  '6',
  '7',
  '8',
  '11b',
  '12',
  '13',
  '14',
] as const;

export type Slice = (typeof SLICES)[number];

/** The newest slice this build reads. A key of a later one is named, not read. */
export const BUILD_SLICE: Slice = '1';

/** The slice that adds the string form of `intent`. */
export const INTENT_STRING_SLICE: Slice = '13';
/** The slice that gives references like `{plan.design}` a meaning. */
export const REFERENCE_SLICE: Slice = '2';

export function isBuiltIn(slice: Slice): boolean {
  return SLICES.indexOf(slice) <= SLICES.indexOf(BUILD_SLICE);
}

export interface KeyRule {
  key: string;
  slice: Slice;
  /** The key names the kind of a stage, and a stage has exactly one. */
  stageKind?: true;
}

/** The keys of one kind of mapping, in the order of the contract's table. */
export interface KeyTable {
  /** Where the mapping sits in the contract's table, such as `stages[].`. */
  prefix: string;
  keys: readonly KeyRule[];
  /** Any key not listed is of this slice, as a param name is. */
  otherKeys?: Slice;
}

const rule = (key: string, slice: Slice, stageKind?: true): KeyRule =>
  stageKind ? { key, slice, stageKind } : { key, slice };

export const TOP_KEYS: KeyTable = {
  prefix: '',
  keys: [
    rule('format', '1'),
    rule('name', '1'),
    rule('version', '1'),
    rule('intent', '1'),
    rule('params', '1'),
    rule('stages', '1'),
    rule('fallback_sop', '11b'),
    rule('runner_options', '12'),
    rule('targets', '14'),
  ],
};

export const INTENT_KEYS: KeyTable = {
  prefix: 'intent.',
  keys: [rule('outcome', '1'), rule('accept', '1'), rule('writes', '3b')],
};

export const CHECK_KEYS: KeyTable = {
  prefix: 'intent.accept[].',
  keys: [rule('id', '1'), rule('file', '1'), rule('run', '3a')],
};

export const PARAMS_KEYS: KeyTable = {
  prefix: 'params.',
  keys: [rule('goal', '1')],
  otherKeys: '2',
};

export const GOAL_KEYS: KeyTable = {
  prefix: 'params.goal.',
  keys: [rule('description', '1'), rule('default', '1')],
};

export const STAGE_KEYS: KeyTable = {
  prefix: 'stages[].',
  keys: [
    rule('name', '1'),
    rule('agent', '1', true),
    rule('prompt', '1'),
    rule('prompt_file', '1'),
    rule('outputs', '2'),
    rule('done_when', '3a'),
    rule('run', '3b', true),
    rule('on_fail', '4'),
    rule('max_iterations', '4'),
    rule('on_exhausted', '4'),
    rule('human_review', '5', true),
    rule('human_input', '5', true),
    rule('parallel', '6'),
    rule('uses', '7', true),
    rule('renamed_from', '8'),
    rule('required', '8'),
    rule('effort', '13'),
    rule('model', '13'),
  ],
};

export const KEY_TABLES: readonly KeyTable[] = [
  TOP_KEYS,
  INTENT_KEYS,
  CHECK_KEYS,
  PARAMS_KEYS,
  GOAL_KEYS,
  STAGE_KEYS,
];

/** The slice of a key in a mapping, or `undefined` if no slice plans it. */
export function sliceOf(table: KeyTable, key: string): Slice | undefined {
  return table.keys.find((r) => r.key === key)?.slice ?? table.otherKeys;
}

/** The keys this build reads, in table order. */
export function builtInKeys(table: KeyTable): string[] {
  return table.keys.filter((rule) => isBuiltIn(rule.slice)).map((r) => r.key);
}

/** Whether a key of a stage names the kind of the stage. */
export function isStageKind(key: string): boolean {
  return STAGE_KEYS.keys.some((r) => r.key === key && r.stageKind);
}
