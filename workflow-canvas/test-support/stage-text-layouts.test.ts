// SPDX-License-Identifier: Apache-2.0
/**
 * Writes edits into files of many list layouts and checks every result with
 * the validator of the stub, so a layout that the writer mixes up fails.
 */
import { describe, expect, it } from 'vitest';
import type { StageView, WorkflowView } from '../src/api/types.ts';
import {
  willRewriteWhole,
  withStages,
} from '../src/designer/core/stage-text.ts';
import { checkWorkflowText } from '../stub-api/core/validator.ts';

/** Writes the item of a stage, its dashes at `dash`; `n` picks a variation. */
type Item = (stage: StageView, dash: string, n: number) => string[];

const plain: Item = (s, d) => [
  `${d}- name: ${s.name}`,
  `${d}  agent: ${s.agent}`,
];
const agentFirst: Item = (s, d) => [
  `${d}- agent: ${s.agent}`,
  `${d}  name: ${s.name}`,
];
const flow: Item = (s, d) => [
  `${d}- {name: ${s.name}, agent: ${s.agent}} # flow`,
];
const dashAlone: Item = (s, d) => [
  `${d}-`,
  `${d}    name: ${s.name}`,
  `${d}    agent: ${s.agent}`,
];
const quoted: Item = (s, d) => [
  `${d}- name: "${s.name}"`,
  `${d}  agent: '${s.agent}'`,
];
const commented: Item = (s, d) => [
  `${d}# about ${s.name}`,
  ...plain(s, d, 0),
  `${d}  # inside`,
];
const mixed: Item = (s, d, n) =>
  [plain, agentFirst, flow, dashAlone, quoted][n % 5]!(s, d, n);

const BLOCK_LAYOUTS: Array<[string, string, Item]> = [
  ['two spaces', '  ', plain],
  ['four spaces', '    ', plain],
  ['three spaces', '   ', plain],
  ['no indent', '', plain],
  ['agent first', '  ', agentFirst],
  ['flow items', '', flow],
  ['dash on its own line', '  ', dashAlone],
  ['dash on its own line, no indent', '', dashAlone],
  ['quoted values', '    ', quoted],
  ['comments around items', '  ', commented],
  ['items of different forms', '  ', mixed],
  ['items of different forms, no indent', '', mixed],
  ['items of different forms, four spaces', '    ', mixed],
];

const FLOW_LAYOUTS: Array<[string, (stages: StageView[]) => string[]]> = [
  [
    'a flow list on the line below stages',
    (s) => [
      `  [${s.map((x) => `{name: ${x.name}, agent: ${x.agent}}`).join(', ')}]`,
    ],
  ],
  [
    'a flow list on several lines',
    (s) => [
      '  [',
      ...s.map((x) => `    {name: ${x.name}, agent: ${x.agent}},`),
      '  ]',
    ],
  ],
];

const ENDINGS: Array<[string, string]> = [
  ['LF', '\n'],
  ['CRLF', '\r\n'],
  ['CR', '\r'],
];

// A small generator with a fixed seed, so a failure repeats.
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEAD = ['# a workflow', 'name: wf', 'intent: Say hi', ''];
const FOOT = ['# footer', ''];

function stagesOf(count: number, agents: string[]): StageView[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `s${i + 1}`,
    agent: agents[i % agents.length]!,
  }));
}

function viewOf(stages: StageView[]): WorkflowView {
  return { name: 'wf', intent: { outcome: 'Say hi' }, stages };
}

function fileOf(eol: string, lines: string[]): string {
  return [...HEAD, 'stages:', ...lines, ...FOOT].join(eol);
}

/** The edits of a list: each is a new list of stages. */
function editsOf(stages: StageView[], pick: () => number): StageView[][] {
  const fresh = { name: 'extra', agent: 'k-tpm' };
  const at = Math.floor(pick() * (stages.length + 1));
  return [
    [...stages, fresh],
    [fresh, ...stages],
    [...stages.slice(0, at), fresh, ...stages.slice(at)],
    ...stages.map((_, i) =>
      stages.map((t, j) => (i === j ? { ...t, name: `${t.name}-b` } : t)),
    ),
    ...stages.map((_, i) =>
      stages.map((t, j) => (i === j ? { ...t, agent: 'k-architect' } : t)),
    ),
    ...stages
      .map((_, i) => stages.filter((__, j) => i !== j))
      .filter((x) => x.length > 0),
    [...stages].reverse(),
    [...stages, fresh, { name: 'extra-2', agent: 'k-tpm' }],
  ];
}

function expectValid(text: string, stages: StageView[], label: string) {
  const result = checkWorkflowText(text, 'wf');
  expect(
    result.diagnostics.map((d) => d.code),
    label,
  ).toEqual([]);
  expect(result.view?.stages, label).toEqual(stages);
}

describe('withStages in every layout of the list', () => {
  it.each(BLOCK_LAYOUTS)(
    'writes valid text in a list with %s',
    (name, dash, item) => {
      const pick = random(name.length);
      for (const [, eol] of ENDINGS) {
        for (let count = 1; count <= 5; count += 1) {
          const stages = stagesOf(count, ['k-developer', 'k-tpm', 'x']);
          const text = fileOf(
            eol,
            stages.flatMap((s, n) => item(s, dash, n)),
          );
          expectValid(text, stages, `${name} as it is`);

          for (const next of editsOf(stages, pick)) {
            const written = withStages(text, viewOf(stages), next);

            expect(willRewriteWhole(text), name).toBe(false);
            expectValid(written, next, `${name} ${JSON.stringify(next)}`);
            expect(
              written.startsWith(`${HEAD.join(eol)}${eol}stages:${eol}`),
            ).toBe(true);
            expect(written.endsWith(FOOT.join(eol))).toBe(true);
          }
        }
      }
    },
  );

  it.each(BLOCK_LAYOUTS)(
    'writes the same text back for no edit in a list with %s',
    (_name, dash, item) => {
      const stages = stagesOf(4, ['k-developer', 'k-tpm']);
      const text = fileOf(
        '\n',
        stages.flatMap((s, n) => item(s, dash, n)),
      );

      expect(withStages(text, viewOf(stages), stages)).toBe(text);
    },
  );

  it.each(BLOCK_LAYOUTS)(
    'puts a new stage under the dashes of the others in a list with %s',
    (_name, dash, item) => {
      const stages = stagesOf(2, ['k-developer']);
      const text = fileOf(
        '\n',
        stages.flatMap((s, n) => item(s, dash, n)),
      );

      const written = withStages(text, viewOf(stages), [
        ...stages,
        { name: 'extra', agent: 'k-tpm' },
      ]);

      expect(written).toContain(
        `\n${dash}- name: extra\n${dash}  agent: k-tpm\n`,
      );
    },
  );
});

describe('withStages when the list cannot take new items', () => {
  it.each(FLOW_LAYOUTS)(
    'writes the whole file, and valid text, for %s',
    (_name, lines) => {
      const stages = stagesOf(2, ['k-developer']);
      const text = fileOf('\n', lines(stages));
      expectValid(text, stages, 'as it is');

      for (const next of editsOf(stages, random(7))) {
        expect(willRewriteWhole(text)).toBe(true);
        expectValid(
          withStages(text, viewOf(stages), next),
          next,
          JSON.stringify(next),
        );
      }
    },
  );
});
