// SPDX-License-Identifier: Apache-2.0
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { FakeScheduler } from '../test-support/fake-scheduler';
import { HELLO_DOCUMENT, HELLO_VIEW, loaded } from '../test-support/fixtures';
import type { WorkflowDocument } from '../api/types';

// The Cloudscape test utils wrap their updates in `act`, which React only
// accepts when the environment says so. Testing Library does that on its own
// only with test globals, so it is set for this file.
const actFlag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actBefore = actFlag.IS_REACT_ACT_ENVIRONMENT;
beforeAll(() => {
  actFlag.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  actFlag.IS_REACT_ACT_ENVIRONMENT = actBefore;
});

async function openDesigner(document: WorkflowDocument = HELLO_DOCUMENT) {
  render(
    <App
      load={Promise.resolve(loaded(document))}
      scheduler={new FakeScheduler()}
    />,
  );
  await screen.findByTestId('node-end');
}

const wrapper = () => createWrapper(document.body);
const nameInput = () =>
  screen.getByRole('textbox', { name: 'name' }) as HTMLInputElement;
const agentSelect = () => wrapper().findSelect()!;
const addButton = () => screen.getByRole('button', { name: 'Add stage' });
const deleteButton = () => screen.getByRole('button', { name: 'Delete stage' });
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
  it('shows the new name on the node at once', async () => {
    await openDesigner();

    type('write');

    expect(screen.getByTestId('node-stage-write').textContent).toContain(
      'write',
    );
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

  it('draws the old name again when the name is put back', async () => {
    await openDesigner();

    type('write');
    type('draft');

    expect(screen.queryByTestId('node-stage-write')).toBeNull();
    expect(screen.getByTestId('node-stage-draft')).toBeTruthy();
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

  it('shows the chosen agent on the node', async () => {
    await openDesigner();

    chooseAgent('k-architect');

    expect(screen.getByTestId('node-stage-draft').textContent).toContain(
      'k-architect · kiro-cli',
    );
  });

  it('keeps an agent that Konductor does not ship, and offers it first', async () => {
    const odd = {
      ...HELLO_DOCUMENT,
      view: {
        ...HELLO_VIEW,
        stages: [{ name: 'draft', agent: 'my-agent' }],
      },
    };
    await openDesigner(odd);

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
    await openDesigner({
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
  });

  it('is off, with the reason, for the last stage', async () => {
    await openDesigner();
    fireEvent.click(deleteButton());

    expect(isOff(deleteButton())).toBe(true);
    fireEvent.click(deleteButton());

    expect(stageLabels()).toHaveLength(1);
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
});

describe('a workflow that the server says is read-only', () => {
  it('turns off every control that would change it', async () => {
    await openDesigner({
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
  });
});
