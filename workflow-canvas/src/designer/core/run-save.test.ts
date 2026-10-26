// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { HELLO_DOCUMENT, HELLO_VIEW } from '../../test-support/fixtures';
import type { EditEvent } from './edit-state';
import { SaveConflict, SaveRefused, type EditPort } from './ports';
import { reloadWorkflow, saveDraft } from './run-save';

const RESULT = { hash: 'b'.repeat(64), view: HELLO_VIEW, diagnostics: [] };

function edits(overrides: Partial<EditPort>): EditPort {
  return {
    save: vi.fn().mockResolvedValue(RESULT),
    check: vi.fn(),
    reload: vi.fn().mockResolvedValue(HELLO_DOCUMENT),
    ...overrides,
  };
}

async function save(port: EditPort): Promise<EditEvent[]> {
  const events: EditEvent[] = [];
  await saveDraft({
    edits: port,
    text: 'text',
    baseHash: 'a'.repeat(64),
    revision: 3,
    emit: (event) => events.push(event),
  });
  return events;
}

describe('saveDraft', () => {
  it('writes the text on its base hash and says it was saved', async () => {
    const port = edits({});

    const events = await save(port);

    expect(port.save).toHaveBeenCalledWith('text', 'a'.repeat(64));
    expect(events).toEqual([{ type: 'saved', text: 'text', result: RESULT }]);
  });

  it('says there was a conflict when the file changed', async () => {
    const port = edits({
      save: vi.fn().mockRejectedValue(new SaveConflict('The file changed.')),
    });

    expect(await save(port)).toEqual([{ type: 'conflict' }]);
  });

  it('gives the findings of a refusal, with the revision that was sent', async () => {
    const findings = [
      { message: 'Wrong.', path: 'intent', line: 1, severity: 'error' },
    ] as const;
    const port = edits({
      save: vi.fn().mockRejectedValue(new SaveRefused('Errors.', findings)),
    });

    expect(await save(port)).toEqual([
      { type: 'refused', revision: 3, diagnostics: findings },
    ]);
  });

  it('gives the sentence of any other failure', async () => {
    const port = edits({
      save: vi.fn().mockRejectedValue(new Error('The server did not answer.')),
    });

    expect(await save(port)).toEqual([
      { type: 'failed', message: 'The server did not answer.' },
    ]);
  });

  it('gives a plain sentence for something that is not an Error', async () => {
    const port = edits({ save: vi.fn().mockRejectedValue('boom') });

    expect(await save(port)).toEqual([
      { type: 'failed', message: 'The workflow was not saved.' },
    ]);
  });
});

describe('reloadWorkflow', () => {
  it('gives the document that was loaded', async () => {
    const events: EditEvent[] = [];

    await reloadWorkflow(edits({}), (event) => events.push(event));

    expect(events).toEqual([{ type: 'reloaded', document: HELLO_DOCUMENT }]);
  });

  it('gives the sentence of a load that failed, and does not reject', async () => {
    const events: EditEvent[] = [];
    const port = edits({
      reload: vi
        .fn()
        .mockRejectedValue(new Error('The server did not answer.')),
    });

    await reloadWorkflow(port, (event) => events.push(event));

    expect(events).toEqual([
      { type: 'reload-failed', message: 'The server did not answer.' },
    ]);
  });
});
