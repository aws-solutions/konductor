// SPDX-License-Identifier: Apache-2.0
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { SaveConflict, SaveLost, SaveRefused } from './core';
import { FakeScheduler } from '../test-support/fake-scheduler';
import {
  acceptingEdits,
  finding,
  SAVED_HASH,
  viewOfText,
  type FakeEdits,
} from '../test-support/fake-edits';
import {
  HELLO_DOCUMENT,
  HELLO_HASH,
  HELLO_TEXT,
  HELLO_VIEW,
  loaded,
} from '../test-support/fixtures';
import type { WorkflowDocument } from '../api/types';

// The tests here wrap their updates in `act`, which React only accepts when the
// environment says so. Testing Library does that on its own only with test
// globals, and the other files do not wrap theirs, so it is set for this file.
const actFlag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actBefore = actFlag.IS_REACT_ACT_ENVIRONMENT;
beforeAll(() => {
  actFlag.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  actFlag.IS_REACT_ACT_ENVIRONMENT = actBefore;
});

async function openDesigner(
  edits: FakeEdits = acceptingEdits(),
  document: WorkflowDocument = HELLO_DOCUMENT,
) {
  const scheduler = new FakeScheduler();
  render(
    <App
      load={Promise.resolve(loaded(document, undefined, edits))}
      scheduler={scheduler}
    />,
  );
  await screen.findByTestId('node-end');
  return { edits, scheduler };
}

const wrapper = () => createWrapper(document.body);
const nameInput = () =>
  screen.getByRole('textbox', { name: 'name' }) as HTMLInputElement;
const agentSelect = () => wrapper().findSelect()!;
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const addButton = () => screen.getByRole('button', { name: 'Add stage' });
const deleteButton = () => screen.getByRole('button', { name: 'Delete stage' });
const status = () => screen.getByTestId('save-status').textContent;
const isOff = (button: HTMLElement) =>
  button.hasAttribute('disabled') ||
  button.getAttribute('aria-disabled') === 'true';
const type = (value: string) =>
  fireEvent.change(nameInput(), { target: { value } });

function chooseAgent(id: string) {
  const select = agentSelect();
  select.openDropdown();
  const index = select
    .findDropdown()
    .findOptions()
    .findIndex((option) => option.getElement().textContent?.startsWith(id));
  if (index < 0) throw new Error(`The agent ${id} is not offered.`);
  select.selectOption(index + 1);
}

// Runs the pause of the check and lets its answer reach the page.
async function checkNow(scheduler: FakeScheduler) {
  await act(async () => {
    scheduler.tick();
  });
}

const stageLabels = () =>
  screen
    .getAllByRole('group')
    .map((node) => node.getAttribute('aria-label') ?? '')
    .filter((label) => label.startsWith('Stage '));

describe('the Properties of the selected stage', () => {
  it('shows the name and agent of the first stage when the workflow opens', async () => {
    await openDesigner();

    expect(screen.getByRole('heading', { name: 'Properties' })).toBeTruthy();
    expect(screen.getByText('Selected:').textContent).toContain('draft');
    expect(nameInput().value).toBe('draft');
    expect(agentSelect().findTrigger().getElement().textContent).toContain(
      'k-developer',
    );
  });

  it('says in the name of the node which stage is selected', async () => {
    await openDesigner();

    expect(stageLabels()).toEqual([
      'Stage draft, agent k-developer, harness kiro-cli, selected',
      'Stage review, agent k-quality-assurance, harness kiro-cli',
    ]);
  });

  it('switches to a stage that is clicked, and moves focus to its name', async () => {
    await openDesigner();

    fireEvent.click(screen.getByTestId('node-stage-review'));

    await waitFor(() => expect(nameInput().value).toBe('review'));
    expect(document.activeElement).toBe(nameInput());
    expect(stageLabels()[1]).toMatch(/, selected$/);
  });

  it('switches to a stage that is chosen with Enter on its node', async () => {
    await openDesigner();
    const node = screen.getByRole('group', {
      name: 'Stage review, agent k-quality-assurance, harness kiro-cli',
    });

    node.focus();
    fireEvent.keyDown(node, { key: 'Enter' });

    await waitFor(() => expect(nameInput().value).toBe('review'));
    expect(document.activeElement).toBe(nameInput());
  });

  it('does not select the intent or the end', async () => {
    await openDesigner();

    fireEvent.click(screen.getByTestId('node-end'));
    fireEvent.click(screen.getByTestId('node-intent'));

    expect(nameInput().value).toBe('draft');
  });

  it('labels the fields and describes the agent', async () => {
    await openDesigner();

    expect(nameInput().getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText(/A Konductor agent id/).textContent).toContain(
      'Backend and frontend code',
    );
  });
});

describe('renaming a stage', () => {
  it('shows the new name on the node at once, and marks the draft unsaved', async () => {
    await openDesigner();

    type('write');

    expect(screen.getByTestId('node-stage-write').textContent).toContain(
      'write',
    );
    expect(status()).toBe('Unsaved changes');
    expect(isOff(saveButton())).toBe(false);
  });

  it('keeps focus in the field while it is typed in', async () => {
    await openDesigner();
    nameInput().focus();

    type('write');
    type('write-it');

    expect(document.activeElement).toBe(nameInput());
    expect(nameInput().value).toBe('write-it');
  });

  it('lets two stages share a name for a moment without losing either node', async () => {
    await openDesigner();

    type('review');

    expect(screen.getAllByTestId('node-stage-review')).toHaveLength(2);
  });

  it('is unsaved no more when the name is put back', async () => {
    await openDesigner();

    type('write');
    type('draft');

    expect(status()).toBe('No changes');
  });
});

describe('picking the agent of a stage', () => {
  it('offers the agents that Konductor ships, with what each is for', async () => {
    await openDesigner();

    agentSelect().openDropdown();

    const options = agentSelect()
      .findDropdown()
      .findOptions()
      .map((option) => option.getElement().textContent ?? '');
    expect(options).toHaveLength(8);
    expect(options[2]).toContain('k-developer');
    expect(options[2]).toContain('Backend and frontend code');
  });

  it('shows the chosen agent on the node and marks the draft unsaved', async () => {
    await openDesigner();

    chooseAgent('k-architect');

    expect(screen.getByTestId('node-stage-draft').textContent).toContain(
      'k-architect · kiro-cli',
    );
    expect(status()).toBe('Unsaved changes');
  });

  it('keeps an agent that Konductor does not ship, and offers it first', async () => {
    const odd = {
      ...HELLO_DOCUMENT,
      view: {
        ...HELLO_VIEW,
        stages: [{ name: 'draft', agent: 'my-agent' }],
      },
    };
    await openDesigner(acceptingEdits(), odd);

    expect(agentSelect().findTrigger().getElement().textContent).toContain(
      'my-agent',
    );
    agentSelect().openDropdown();
    expect(
      agentSelect().findDropdown().findOptions()[0]?.getElement().textContent,
    ).toContain('my-agent');
  });
});

describe('adding a stage', () => {
  it('adds an agent stage at the end, selects it and moves focus to its name', async () => {
    await openDesigner();
    addButton().focus();

    fireEvent.click(addButton());

    expect(screen.getByTestId('node-stage-agent-1').textContent).toContain(
      'k-developer',
    );
    expect(nameInput().value).toBe('agent-1');
    await waitFor(() => expect(document.activeElement).toBe(nameInput()));
    expect(status()).toBe('Unsaved changes');
    expect(stageLabels()).toHaveLength(3);
  });

  it('names the next stage agent-2', async () => {
    await openDesigner();

    fireEvent.click(addButton());
    fireEvent.click(addButton());

    expect(screen.getByTestId('node-stage-agent-2')).toBeTruthy();
  });

  it('is off, with the reason, at the most stages the API allows', async () => {
    const stages = Array.from({ length: 40 }, (_, index) => ({
      name: `stage-${index}`,
      agent: 'k-developer',
    }));
    await openDesigner(acceptingEdits(), {
      ...HELLO_DOCUMENT,
      view: { ...HELLO_VIEW, stages },
    });

    expect(isOff(addButton())).toBe(true);
    fireEvent.click(addButton());

    expect(stageLabels()).toHaveLength(40);
  });
});

describe('deleting a stage', () => {
  it('removes the selected stage, selects its neighbour and moves focus to the name', async () => {
    await openDesigner();
    fireEvent.click(screen.getByTestId('node-stage-review'));
    await waitFor(() => expect(nameInput().value).toBe('review'));

    fireEvent.click(deleteButton());

    expect(screen.queryByTestId('node-stage-review')).toBeNull();
    expect(nameInput().value).toBe('draft');
    await waitFor(() => expect(document.activeElement).toBe(nameInput()));
    expect(status()).toBe('Unsaved changes');
  });

  it('is off, with the reason, for the last stage', async () => {
    await openDesigner();
    fireEvent.click(deleteButton());

    expect(isOff(deleteButton())).toBe(true);
    fireEvent.click(deleteButton());

    expect(stageLabels()).toHaveLength(1);
  });
});

describe('saving', () => {
  it('has nothing to save at first, and says why', async () => {
    await openDesigner();

    expect(isOff(saveButton())).toBe(true);
    expect(status()).toBe('No changes');
  });

  it('writes the saved text with the new stages on the hash it loaded', async () => {
    const { edits } = await openDesigner();
    chooseAgent('k-architect');

    fireEvent.click(saveButton());

    expect(edits.save).toHaveBeenCalledOnce();
    expect(edits.save).toHaveBeenCalledWith(
      HELLO_TEXT.replace('k-developer', 'k-architect'),
      HELLO_HASH,
    );
    await waitFor(() => expect(status()).toBe('Saved'));
  });

  it('says Saved, turns Save off and keeps focus on it', async () => {
    await openDesigner();
    chooseAgent('k-architect');
    saveButton().focus();

    fireEvent.click(saveButton());

    await waitFor(() => expect(status()).toBe('Saved'));
    expect(isOff(saveButton())).toBe(true);
    expect(document.activeElement).toBe(saveButton());
  });

  it('writes the next save on the hash of the last one', async () => {
    const { edits } = await openDesigner();
    type('write');
    fireEvent.click(saveButton());
    await waitFor(() => expect(status()).toBe('Saved'));

    type('write-it');
    fireEvent.click(saveButton());

    await waitFor(() => expect(edits.save).toHaveBeenCalledTimes(2));
    expect(edits.save.mock.calls[1]?.[1]).toBe(SAVED_HASH);
  });

  it('does not save twice when Save is pressed twice at once', async () => {
    const { edits } = await openDesigner();
    type('write');

    fireEvent.click(saveButton());
    fireEvent.click(saveButton());

    await waitFor(() => expect(status()).toBe('Saved'));
    expect(edits.save).toHaveBeenCalledOnce();
  });

  it('says Saving while the call is under way', async () => {
    const edits = acceptingEdits();
    let finish: () => void = () => {};
    edits.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ hash: SAVED_HASH, view: HELLO_VIEW, diagnostics: [] });
        }),
    );
    await openDesigner(edits);
    type('write');

    fireEvent.click(saveButton());

    expect(status()).toBe('Saving');
    await act(async () => finish());
  });
});

describe('checking while typing', () => {
  it('does not ask the server until the text has been still for the pause', async () => {
    const { edits, scheduler } = await openDesigner();

    type('write');

    expect(scheduler.pendingCount).toBe(1);
    expect(edits.check).not.toHaveBeenCalled();
  });

  it('asks once for a name typed in several keys', async () => {
    const { edits, scheduler } = await openDesigner();

    type('w');
    type('wr');
    type('write');
    await checkNow(scheduler);

    expect(edits.check).toHaveBeenCalledOnce();
    expect(edits.check).toHaveBeenCalledWith(
      HELLO_TEXT.replace('name: draft', 'name: write'),
    );
  });

  it('shows what the server found under the field and in the list of problems', async () => {
    const edits = acceptingEdits();
    edits.check.mockResolvedValue({
      view: null,
      diagnostics: [
        finding('stages[1].name', 'The stage name `draft` is already used.'),
      ],
    });
    const { scheduler } = await openDesigner(edits);
    fireEvent.click(screen.getByTestId('node-stage-review'));
    await waitFor(() => expect(nameInput().value).toBe('review'));

    type('draft');
    await checkNow(scheduler);

    const problems = await screen.findByTestId('problems');
    expect(
      within(problems).getByText(
        'draft: The stage name `draft` is already used.',
      ),
    ).toBeTruthy();
    expect(nameInput().getAttribute('aria-invalid')).toBe('true');
    expect(
      screen.getAllByText('The stage name `draft` is already used.'),
    ).toHaveLength(1);
    expect(screen.getByText('Needs a fix')).toBeTruthy();
  });

  it('marks the field of the stage being renamed to a name that another stage has, though the server names the later stage', async () => {
    const edits = acceptingEdits();
    edits.check.mockResolvedValue({
      view: null,
      diagnostics: [
        finding('stages[1].name', 'The stage name `review` is already used.'),
      ],
    });
    const { scheduler } = await openDesigner(edits);
    expect(nameInput().value).toBe('draft');

    type('review');
    await checkNow(scheduler);

    await waitFor(() =>
      expect(nameInput().getAttribute('aria-invalid')).toBe('true'),
    );
    expect(
      screen.getAllByText('The stage name `review` is already used.'),
    ).toHaveLength(1);
    expect(screen.getByText('Needs a fix')).toBeTruthy();
    const items = within(screen.getByTestId('problems')).getAllByRole(
      'listitem',
    );
    expect(items.map((item) => item.textContent)).toEqual([
      'review: The stage name `review` is already used.',
    ]);
  });

  it('names a stage with no name by its place in the list, not by an empty word', async () => {
    const edits = acceptingEdits();
    const message =
      '`name` must be lower-case letters, digits and hyphens, start with a letter or digit, and have at most 64 characters.';
    edits.check.mockResolvedValue({
      view: null,
      diagnostics: [finding('stages[0].name', message)],
    });
    const { scheduler } = await openDesigner(edits);

    type('');
    await checkNow(scheduler);

    const items = await within(
      await screen.findByTestId('problems'),
    ).findAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      `Stage 1: ${message}`,
    ]);
  });

  it('shows a warning as a note, not as an error, and leaves Save on', async () => {
    const edits = acceptingEdits();
    edits.check.mockResolvedValue({
      view: null,
      diagnostics: [
        {
          ...finding('stages[0].name', 'The name is long.'),
          severity: 'warning',
        },
      ],
    });
    const { scheduler } = await openDesigner(edits);

    type('write');
    await checkNow(scheduler);

    const notes = await screen.findByTestId('notes');
    expect(within(notes).getByText('write: The name is long.')).toBeTruthy();
    expect(screen.queryByTestId('problems')).toBeNull();
    expect(nameInput().getAttribute('aria-invalid')).not.toBe('true');
    expect(screen.queryByText('Needs a fix')).toBeNull();
    expect(screen.getByText('Has a note')).toBeTruthy();
    expect(isOff(saveButton())).toBe(false);
  });

  it('turns Save off, with the reason, while the check has found an error', async () => {
    const edits = acceptingEdits();
    edits.check.mockResolvedValue({
      view: null,
      diagnostics: [finding('stages[0].name', 'Not a name.')],
    });
    const { scheduler } = await openDesigner(edits);
    saveButton();

    type('Not A Name');
    await checkNow(scheduler);

    await screen.findByTestId('problems');
    expect(isOff(saveButton())).toBe(true);
    fireEvent.click(saveButton());
    expect(edits.save).not.toHaveBeenCalled();
  });

  it('keeps the problems on show while the next check is still to come', async () => {
    const edits = acceptingEdits();
    edits.check.mockResolvedValueOnce({
      view: null,
      diagnostics: [finding('stages[0].name', 'Not a name.')],
    });
    const { scheduler } = await openDesigner(edits);
    type('Bad');
    await checkNow(scheduler);
    const problems = await screen.findByTestId('problems');

    type('Bad2');

    expect(screen.getByTestId('problems')).toBe(problems);
    expect(screen.getByText('Not a name.')).toBeTruthy();
    await checkNow(scheduler);
    await waitFor(() => expect(screen.queryByTestId('problems')).toBeNull());
  });

  it('clears the problems when the next check finds none', async () => {
    const edits = acceptingEdits();
    edits.check.mockResolvedValueOnce({
      view: null,
      diagnostics: [finding('stages[0].name', 'Not a name.')],
    });
    const { scheduler } = await openDesigner(edits);
    type('Bad');
    await checkNow(scheduler);
    await screen.findByTestId('problems');

    type('good');
    await checkNow(scheduler);

    await waitFor(() => expect(screen.queryByTestId('problems')).toBeNull());
    expect(isOff(saveButton())).toBe(false);
  });

  it('shows a finding about the whole text without a stage in front of it', async () => {
    const edits = acceptingEdits();
    edits.check.mockResolvedValue({
      view: null,
      diagnostics: [finding('stages', 'A workflow needs a stage.')],
    });
    const { scheduler } = await openDesigner(edits);

    type('write');
    await checkNow(scheduler);

    expect(
      within(await screen.findByTestId('problems')).getByText(
        'A workflow needs a stage.',
      ),
    ).toBeTruthy();
  });

  it('says nothing when the check cannot reach the server', async () => {
    const edits = acceptingEdits();
    edits.check.mockRejectedValue(new Error('No answer.'));
    const { scheduler } = await openDesigner(edits);

    type('write');
    await checkNow(scheduler);

    expect(screen.queryByTestId('problems')).toBeNull();
    expect(isOff(saveButton())).toBe(false);
  });
});

describe('a save that is refused', () => {
  it('shows the findings of the server under the field', async () => {
    const edits = acceptingEdits();
    edits.save.mockRejectedValue(
      new SaveRefused('The workflow has errors.', [
        finding('stages.write.agent', 'The agent id is not valid.'),
      ]),
    );
    await openDesigner(edits);
    type('write');

    fireEvent.click(saveButton());

    const problems = await screen.findByTestId('problems');
    expect(
      within(problems).getByText('write: The agent id is not valid.'),
    ).toBeTruthy();
    expect(status()).toBe('Unsaved changes');
  });
});

describe('a save that finds the file changed', () => {
  async function conflict() {
    const edits = acceptingEdits();
    edits.save.mockRejectedValue(new SaveConflict('The file changed.'));
    const opened = await openDesigner(edits);
    type('write');
    saveButton().focus();
    fireEvent.click(saveButton());
    await screen.findByTestId('conflict');
    return opened;
  }

  it('says so, and offers to load the file again', async () => {
    await conflict();

    const alert = screen.getByTestId('conflict');
    expect(alert.textContent).toContain('The file changed on disk');
    expect(alert.textContent).toContain('nothing was saved');
    expect(within(alert).getByRole('button')).toBeTruthy();
    expect(isOff(saveButton())).toBe(true);
  });

  it('is announced, and leaves focus where it was', async () => {
    await conflict();

    expect(
      screen.getByTestId('conflict').closest('[role="alert"]'),
    ).toBeTruthy();
    expect(document.activeElement).toBe(saveButton());
  });

  it('loads the file again, drops the draft and moves focus to the name', async () => {
    const { edits } = await conflict();
    edits.reload.mockResolvedValue({
      ...HELLO_DOCUMENT,
      hash: 'e'.repeat(64),
      view: { ...HELLO_VIEW, stages: [{ name: 'only', agent: 'k-tpm' }] },
    });
    const reload = within(screen.getByTestId('conflict')).getByRole('button');
    reload.focus();

    fireEvent.click(reload);

    await waitFor(() => expect(screen.queryByTestId('conflict')).toBeNull());
    expect(nameInput().value).toBe('only');
    expect(stageLabels()).toHaveLength(1);
    expect(status()).toBe('Loaded again from the server');
    await waitFor(() => expect(document.activeElement).toBe(nameInput()));
  });

  it('keeps the conflict, with the sentence, when the load fails', async () => {
    const { edits } = await conflict();
    edits.reload.mockRejectedValue(new Error('The server did not answer.'));

    fireEvent.click(within(screen.getByTestId('conflict')).getByRole('button'));

    await waitFor(() =>
      expect(screen.getByTestId('conflict').textContent).toContain(
        'The server did not answer.',
      ),
    );
    expect(nameInput().value).toBe('write');
  });
});

describe('a save that fails', () => {
  it('shows the sentence of the failure and lets the save be tried again', async () => {
    const edits = acceptingEdits();
    edits.save.mockRejectedValueOnce(new Error('The server did not answer.'));
    await openDesigner(edits);
    type('write');

    fireEvent.click(saveButton());

    expect(await screen.findByText('The server did not answer.')).toBeTruthy();
    expect(status()).toBe('Unsaved changes');
    fireEvent.click(saveButton());
    await waitFor(() => expect(status()).toBe('Saved'));
    expect(screen.queryByText('The server did not answer.')).toBeNull();
  });
});

describe('a save whose answer is lost', () => {
  it('counts the save as done when the file holds the text that was sent', async () => {
    const edits = acceptingEdits();
    let sent = '';
    edits.save.mockImplementationOnce(async (text) => {
      sent = text;
      throw new SaveLost('The server did not answer.');
    });
    edits.reload.mockImplementationOnce(async () => ({
      ...HELLO_DOCUMENT,
      text: sent,
      hash: SAVED_HASH,
      view: viewOfText(sent),
    }));
    await openDesigner(edits);
    type('write');

    fireEvent.click(saveButton());

    await waitFor(() => expect(status()).toBe('Saved'));
    expect(screen.queryByText('The server did not answer.')).toBeNull();
    expect(nameInput().value).toBe('write');
  });

  it('shows the failure when the file does not hold the text', async () => {
    const edits = acceptingEdits();
    edits.save.mockRejectedValueOnce(
      new SaveLost('The server did not answer.'),
    );
    await openDesigner(edits);
    type('write');

    fireEvent.click(saveButton());

    expect(await screen.findByText('The server did not answer.')).toBeTruthy();
    expect(status()).toBe('Unsaved changes');
  });
});

describe('a file whose stages are not a block', () => {
  const FLOW = {
    ...HELLO_DOCUMENT,
    text: 'name: hello\nintent: Add a greeting to the README\nstages: [{name: draft, agent: k-developer}]\n',
  };

  it('says before a save that the file is written whole', async () => {
    await openDesigner(acceptingEdits(), FLOW);

    const note = screen.getByTestId('rewrite-notice');

    expect(note.textContent).toContain('Saving rewrites this file');
    expect(note.textContent).toContain('comments');
  });

  it('says nothing for a file with a block of stages', async () => {
    await openDesigner();

    expect(screen.queryByTestId('rewrite-notice')).toBeNull();
  });
});

describe('the two tabs', () => {
  it('keeps the draft when the tab is switched away and back', async () => {
    await openDesigner();
    type('write');

    fireEvent.click(screen.getByRole('tab', { name: 'Execution' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Designer' }));

    expect(await screen.findByTestId('node-stage-write')).toBeTruthy();
    expect(nameInput().value).toBe('write');
  });

  it('draws the saved workflow on Execution and says the draft is not part of a run', async () => {
    await openDesigner();
    type('write');

    fireEvent.click(screen.getByRole('tab', { name: 'Execution' }));

    const panel = screen.getByRole('tabpanel', { name: 'Execution' });
    expect(await within(panel).findByTestId('node-stage-draft')).toBeTruthy();
    expect(within(panel).queryByTestId('node-stage-write')).toBeNull();
    expect(within(panel).getByTestId('unsaved-note')).toBeTruthy();
  });

  it('draws what was saved on Execution, with no note', async () => {
    await openDesigner();
    type('write');
    fireEvent.click(saveButton());
    await waitFor(() => expect(status()).toBe('Saved'));

    fireEvent.click(screen.getByRole('tab', { name: 'Execution' }));

    const panel = screen.getByRole('tabpanel', { name: 'Execution' });
    expect(await within(panel).findByTestId('node-stage-write')).toBeTruthy();
    expect(within(panel).queryByTestId('unsaved-note')).toBeNull();
  });
});

describe('a workflow that the server says is read-only', () => {
  it('turns off every control that would change it', async () => {
    await openDesigner(acceptingEdits(), {
      ...HELLO_DOCUMENT,
      readOnly: true,
    });

    expect(nameInput().readOnly).toBe(true);
    expect(
      agentSelect().findTrigger().getElement().hasAttribute('disabled') ||
        agentSelect()
          .findTrigger()
          .getElement()
          .getAttribute('aria-disabled') === 'true',
    ).toBe(true);
    expect(isOff(addButton())).toBe(true);
    expect(isOff(deleteButton())).toBe(true);
    expect(isOff(saveButton())).toBe(true);
  });
});

describe('a workflow that cannot be edited', () => {
  it('is only drawn when it has no file', async () => {
    render(
      <App
        load={Promise.resolve(
          loaded({ ...HELLO_DOCUMENT, text: null, hash: null, view: null }),
        )}
        scheduler={new FakeScheduler()}
      />,
    );

    expect(await screen.findByText('Nothing to draw')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
