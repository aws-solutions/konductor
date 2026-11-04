// SPDX-License-Identifier: Apache-2.0
/** Reads the real replies of the stub with the parsers of the page. */
import { describe, expect, it } from 'vitest';
import { parseSession, parseWorkflowDocument } from '../../src/api/parse.ts';
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
