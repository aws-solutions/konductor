// SPDX-License-Identifier: Apache-2.0
/** Reads the real replies of the stub with the parsers of the page. */
import { describe, expect, it } from 'vitest';
import {
  errorDiagnosticsOf,
  parseCheckResult,
  parseSaveResult,
  parseSession,
  parseWorkflowDocument,
} from '../../src/api/parse.ts';
import {
  draftOf,
  renameStage,
  stagesOf,
} from '../../src/designer/core/draft.ts';
import { problemsOf } from '../../src/designer/core/problems.ts';
import { withStages } from '../../src/designer/core/stage-text.ts';
import { sha256Hex } from '../core/hash.ts';
import { SAMPLE_FILES } from '../core/sample.ts';
import { LAUNCH_CODE, useStub } from '../test-support/harness.ts';
import { oneStageWorkflow } from '../test-support/workflows.ts';

const PATH = '/api/workflow';

describe('the wire types of the page read POST /api/session', () => {
  const stub = useStub({}, false);

  it('with the reply of the stub', async () => {
    const reply = await stub().client.post('/api/session', {
      code: LAUNCH_CODE,
    });

    expect(parseSession(reply.body)).toMatchObject({
      harness: 'kiro-cli',
      apiVersion: 1,
    });
  });
});

describe('the wire types of the page read GET /api/workflow', () => {
  const stub = useStub();

  it('with the sample workflow', async () => {
    const reply = await stub().client.get(PATH);

    expect(parseWorkflowDocument(reply.body)).toEqual({
      name: 'hello',
      text: expect.stringContaining('name: hello'),
      hash: sha256Hex(SAMPLE_FILES.hello ?? ''),
      view: {
        name: 'hello',
        intent: { outcome: 'Add a greeting to the README' },
        stages: [
          { name: 'draft', agent: 'k-developer' },
          { name: 'review', agent: 'k-quality-assurance' },
        ],
      },
      diagnostics: [],
    });
  });
});

describe('the wire types of the page read GET /api/workflow with errors', () => {
  const stub = useStub({ files: { hello: 'name: hello\nowner: me\n' } });

  it('with a null view and diagnostics that have a message and a line', async () => {
    const reply = await stub().client.get(PATH);
    const document = parseWorkflowDocument(reply.body);

    expect(document.view).toBeNull();
    expect(document.diagnostics.length).toBeGreaterThan(0);
    for (const { message, line } of document.diagnostics) {
      expect(message).not.toBe('');
      expect(line).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('the wire types of the page read GET /api/workflow without a file', () => {
  const stub = useStub({ files: {} });

  it('with null text and a null view', async () => {
    const reply = await stub().client.get(PATH);

    expect(parseWorkflowDocument(reply.body)).toMatchObject({
      text: null,
      view: null,
    });
  });
});

describe('the wire types of the page read GET /api/workflow with another workflow', () => {
  const stub = useStub({
    files: { hello: oneStageWorkflow('solo', 'k-developer') },
  });

  it('with the stages of that workflow', async () => {
    const reply = await stub().client.get(PATH);

    expect(parseWorkflowDocument(reply.body).view?.stages).toEqual([
      { name: 'solo', agent: 'k-developer' },
    ]);
  });
});

// The text that the Designer writes is read back by the stub as the stages
// that were edited, and every refusal comes back in a form the page reads.
describe('the wire types and text of the Designer against PUT /api/workflow', () => {
  const stub = useStub();
  const sample = SAMPLE_FILES.hello ?? '';
  const document = () =>
    stub()
      .client.get(PATH)
      .then((reply) => parseWorkflowDocument(reply.body));

  async function edited(
    change: (names: ReturnType<typeof draftOf>) => ReturnType<typeof draftOf>,
  ) {
    const loaded = await document();
    if (!loaded.view) throw new Error('The sample has no view.');
    const draft = change(draftOf(loaded.view.stages));
    return {
      loaded,
      text: withStages(sample, loaded.view, stagesOf(draft)),
      draft,
    };
  }

  it('accepts the text of a renamed stage and returns the new view', async () => {
    const { loaded, text } = await edited((draft) =>
      renameStage(draft, 's1', 'write'),
    );

    const reply = await stub().client.put(PATH, {
      text,
      base_hash: loaded.hash,
    });

    expect(reply.status).toBe(200);
    const saved = parseSaveResult(reply.body);
    expect(saved.hash).toBe(sha256Hex(text));
    expect(saved.view.stages.map((stage) => stage.name)).toEqual([
      'write',
      'review',
    ]);
    expect((await document()).hash).toBe(saved.hash);
  });

  it('answers a save on a stale hash with the code conflict', async () => {
    const { text } = await edited((draft) => renameStage(draft, 's1', 'write'));

    const reply = await stub().client.put(PATH, {
      text,
      base_hash: 'f'.repeat(64),
    });

    expect(reply.status).toBe(409);
    expect(reply.body).toMatchObject({ code: 'conflict' });
  });

  it('refuses a duplicate name with findings that name the later stage', async () => {
    const { loaded, text, draft } = await edited((start) =>
      renameStage(start, 's2', 'draft'),
    );

    const reply = await stub().client.put(PATH, {
      text,
      base_hash: loaded.hash,
    });

    expect(reply.status).toBe(422);
    expect(problemsOf(errorDiagnosticsOf(reply.body), draft)).toMatchObject([
      { stageId: 's2', field: 'name' },
    ]);
  });

  it('checks the same text without writing it', async () => {
    const { text, draft } = await edited((start) =>
      renameStage(start, 's2', 'Not A Name'),
    );

    const reply = await stub().client.post('/api/validate', { text });

    const check = parseCheckResult(reply.body);
    expect(check.view).toBeNull();
    expect(problemsOf(check.diagnostics, draft)).toMatchObject([
      { stageId: 's2', field: 'name' },
    ]);
    expect((await document()).text).toBe(sample);
  });

  it('puts a finding about an agent on the stage that is named', async () => {
    const { text, draft } = await edited((start) => ({
      ...start,
      stages: start.stages.map((stage) =>
        stage.id === 's1' ? { ...stage, agent: 'Bad Agent' } : stage,
      ),
    }));

    const check = parseCheckResult(
      (await stub().client.post('/api/validate', { text })).body,
    );

    expect(problemsOf(check.diagnostics, draft)).toMatchObject([
      { stageId: 's1', field: 'agent' },
    ]);
  });
});
