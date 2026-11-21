// SPDX-License-Identifier: Apache-2.0
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useMemo } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkflowDocument } from '../api/types';
import type { StageFieldRule } from '../designer-view/field-rules';
import type { CheckAnswer, CheckRequest } from '../designer-view/yaml-draft';
import { useEditor, type Editor } from '../designer/use-editor';
import { textOf } from '../designer/core';
import { SaveConflict, SaveLost, SessionLost } from '../designer/core/ports';
import { FakeScheduler } from '../test-support/fake-scheduler';
import {
  acceptingEdits,
  viewOfText,
  SAVED_HASH,
  type FakeEdits,
} from '../test-support/fake-edits';
import { HELLO_DOCUMENT, NO_RUNS } from '../test-support/fixtures';
import { DesignView, type StageFieldsByKind } from './DesignView';
import { FINDINGS_PER_PAGE, FINDINGS_SHOWN_MOST } from './findings';

const settle = () => act(async () => {});

// These tests wrap their updates in `act`, which React only accepts when the
// environment says so.
const actFlag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actBefore = actFlag.IS_REACT_ACT_ENVIRONMENT;
beforeAll(() => {
  actFlag.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  actFlag.IS_REACT_ACT_ENVIRONMENT = actBefore;
});

const RULES: readonly StageFieldRule[] = [
  { key: 'name', type: 'name', required: true, max_length: 64 },
  { key: 'agent', type: 'name', required: true, max_length: 64 },
  { key: 'prompt', type: 'text', required: false, min_length: 1 },
  { key: 'prompt_file', type: 'path', required: false },
];

const FIELDS: StageFieldsByKind = { agent: RULES };

const TEXT_WITH_PROMPT = `format: konductor/1
name: hello
version: 0.1.0
intent:
  outcome: Add a greeting to the README
stages:
  - name: draft
    agent: k-developer
    prompt: Write the greeting to README.md.
  - name: review
    agent: k-quality-assurance
`;

const TEXT_WITH_PROMPT_FILE = `format: konductor/1
name: hello
version: 0.1.0
intent:
  outcome: Add a greeting to the README
stages:
  - name: draft
    agent: k-developer
    prompt_file: review.md
  - name: review
    agent: k-quality-assurance
`;

// A loaded workflow whose first stage has a key that only the file holds:
// the parsed view the page keeps has the name and the agent only.
const withText = (text: string): WorkflowDocument => ({
  ...HELLO_DOCUMENT,
  text,
});

const WITH_PROMPT = withText(TEXT_WITH_PROMPT);
const WITH_PROMPT_FILE = withText(TEXT_WITH_PROMPT_FILE);

// The second stage is the one with the prompt, so a save that lands after the
// first stage was deleted would pair them wrongly by position.
const PROMPT_SECOND = withText(`format: konductor/1
name: hello
version: 0.1.0
intent:
  outcome: Add a greeting to the README
stages:
  - name: draft
    agent: k-developer
  - name: review
    agent: k-quality-assurance
    prompt: Check the greeting.
`);

// A comment inside the stage that is edited: the writer builds that stage
// from its name and its agent, so the comment would go with the save.
const COMMENT_INSIDE = withText(`format: konductor/1
name: hello
version: 0.1.0
intent:
  outcome: Add a greeting to the README
stages:
  - name: draft
    # The one that writes it.
    agent: k-developer
  - name: review
    agent: k-quality-assurance
`);

// A comment in front of a later stage, which the writer reads as part of
// that stage and drops when it writes it again.
const COMMENT_BEFORE = withText(`format: konductor/1
name: hello
version: 0.1.0
intent:
  outcome: Add a greeting to the README
stages:
  - name: draft
    agent: k-developer
  # The one that checks it.
  - name: review
    agent: k-quality-assurance
`);

// Another workflow, as the page opens when a second address is pasted.
const OTHER_WORKFLOW: WorkflowDocument = {
  ...HELLO_DOCUMENT,
  name: 'ship',
  hash: 'd'.repeat(64),
  text: `format: konductor/1
name: ship
version: 0.1.0
intent:
  outcome: Ship the greeting
stages:
  - name: package
    agent: k-developer
`,
  view: {
    ...HELLO_DOCUMENT.view!,
    name: 'ship',
    stages: [{ name: 'package', agent: 'k-developer' }],
  },
};

// A file the stage writer cannot edit in place: its stages are a list in the
// flow form, so a save would write the whole file in the plain layout and
// drop its params, its comments and its version.
const FLOW_STAGES = withText(`# The greeting workflow.
format: konductor/1
name: hello
version: 2.3.0
params:
  tone:
    type: string
    default: friendly
intent:
  outcome: Add a greeting to the README
stages: [{ name: draft, agent: k-developer }, { name: review, agent: k-quality-assurance }]
`);

// A file whose stage names an agent that `GET /api/agents` does not list.
const UNLISTED_AGENT: WorkflowDocument = {
  ...withText(`format: konductor/1
name: hello
version: 0.1.0
intent:
  outcome: Add a greeting to the README
stages:
  - name: draft
    agent: k-legacy
  - name: review
    agent: k-quality-assurance
`),
  view: {
    ...HELLO_DOCUMENT.view!,
    stages: [
      { name: 'draft', agent: 'k-legacy' },
      { name: 'review', agent: 'k-quality-assurance' },
    ],
  },
};

// The stages of a text, as the sample lays them out, with the lines they
// take up and a prompt when the text has one, which a real check works out
// from the whole file.
function stagesOf(text: string) {
  const lines = text.split('\n');
  return lines.flatMap((line, index) => {
    const name = /^ {2}- name: (.+)$/.exec(line)?.[1];
    if (name === undefined) return [];
    // The keys of the stage are the lines under it, up to the next item.
    const body: string[] = [];
    for (let at = index + 1; at < lines.length; at += 1) {
      const next = lines[at] ?? '';
      if (!/^ {4}\S/.test(next) && !/^ {4}#/.test(next)) break;
      body.push(next);
    }
    const keyed = (key: string) =>
      body
        .map((one) => new RegExp(`^ {4}${key}: (.+)$`).exec(one)?.[1])
        .find((one) => one !== undefined);
    const prompt = keyed('prompt');
    const file = keyed('prompt_file');
    return [
      {
        name,
        kind: 'agent',
        agent: keyed('agent') ?? '',
        ...(prompt === undefined ? {} : { prompt }),
        ...(file === undefined ? {} : { prompt_file: file }),
        range: { line: index + 1, end_line: index + 1 + body.length },
      },
    ];
  });
}

function goodAnswer(text: string): CheckAnswer {
  return {
    errors: 0,
    warnings: 0,
    infos: 0,
    view: {
      format: 'konductor/1',
      version: '0.1.0',
      name: 'hello',
      intent: { outcome: 'Add a greeting to the README' },
      stages: stagesOf(text),
    },
    diagnostics: [],
  };
}

const badAnswer: CheckAnswer = {
  errors: 1,
  warnings: 0,
  infos: 0,
  view: null,
  diagnostics: [
    {
      code: 'INVALID_NAME',
      severity: 'error',
      path: 'stages[0].name',
      line: 13,
      column: 11,
      end_line: 13,
      end_column: 13,
      message: 'A stage name is lower case letters, digits and hyphens.',
    },
  ],
};

function Harness({
  document: workflow = HELLO_DOCUMENT,
  edits,
  scheduler,
  validate,
  stageFields = FIELDS,
  agents,
  onEditor,
}: {
  document?: WorkflowDocument;
  edits: FakeEdits;
  scheduler: FakeScheduler;
  validate: (
    request: CheckRequest,
    signal: AbortSignal,
  ) => Promise<CheckAnswer>;
  stageFields?: StageFieldsByKind;
  agents?: readonly { readonly id: string; readonly summary: string }[];
  /** Hands the editor to the test, which other views of the page also hold. */
  onEditor?: (editor: Editor) => void;
}) {
  const workflowRef = useMemo(
    () => ({ harness: 'kiro-cli', document: workflow, edits, runs: NO_RUNS }),
    [workflow, edits],
  );
  const editor = useEditor(workflowRef, scheduler);
  if (editor) onEditor?.(editor);
  if (!editor) return null;
  return (
    <DesignView
      editor={editor}
      loaded={workflowRef}
      harness="kiro-cli"
      validate={validate}
      scheduler={scheduler}
      stageFields={stageFields}
      {...(agents ? { agents } : {})}
    />
  );
}

function drawn({
  document: workflow = HELLO_DOCUMENT,
  answers,
  openedFails,
  openedHeld = false,
  agents,
}: {
  document?: WorkflowDocument;
  /** The answers of the checks that follow an edit, in order. */
  answers?: CheckAnswer[];
  /** The check of the loaded text fails with this message. */
  openedFails?: string;
  /** The check of the loaded text never answers, as one in flight. */
  openedHeld?: boolean;
  /** The agents on offer for the `agent` key. */
  agents?: readonly { readonly id: string; readonly summary: string }[];
} = {}) {
  const scheduler = new FakeScheduler();
  const edits = acceptingEdits();
  const queued = [...(answers ?? [])];
  const savedText = workflow.text ?? '';
  // The check of the text as loaded is its own call; the queued answers are
  // for the checks that follow an edit.
  const validate = vi.fn(async (request: CheckRequest) => {
    if (request.text === savedText) {
      if (openedHeld) return new Promise<CheckAnswer>(() => undefined);
      if (openedFails !== undefined) throw new Error(openedFails);
      return goodAnswer(request.text);
    }
    return queued.length > 0 ? queued.shift()! : goodAnswer(request.text);
  });
  // The editor of the page, which another view could edit while this one is
  // on show.
  const held: { editor?: Editor } = {};
  const view = render(
    <Harness
      document={workflow}
      edits={edits}
      scheduler={scheduler}
      validate={validate}
      onEditor={(one) => {
        held.editor = one;
      }}
      {...(agents ? { agents } : {})}
    />,
  );
  const editorOf = () => {
    if (!held.editor) throw new Error('The view has no editor yet.');
    return held.editor;
  };
  /** Draws the page again with another workflow, as opening one does. */
  const open = (next: WorkflowDocument) =>
    act(async () => {
      view.rerender(
        <Harness
          document={next}
          edits={edits}
          scheduler={scheduler}
          validate={validate}
          onEditor={(one) => {
            held.editor = one;
          }}
          {...(agents ? { agents } : {})}
        />,
      );
    });
  return { scheduler, validate, edits, editorOf, open };
}

const wrapper = () => createWrapper(document.body);
const tab = (name: string) => screen.getByRole('tab', { name });
const panelOf = (name: string) =>
  screen.getByRole('tabpanel', { name }) as HTMLElement;
const nameInput = () =>
  within(panelOf('Properties')).getByRole('textbox', {
    name: 'name',
  }) as HTMLInputElement;
const promptInput = () =>
  within(panelOf('Properties')).getByRole('textbox', {
    name: 'prompt',
  }) as HTMLTextAreaElement;
const button = (label: string) =>
  screen.getByRole('button', { name: label }) as HTMLButtonElement;
const isOff = (element: HTMLElement) =>
  element.hasAttribute('disabled') ||
  element.getAttribute('aria-disabled') === 'true';

async function openProperties() {
  await act(async () => {
    fireEvent.click(tab('Properties'));
  });
}

async function openYaml() {
  await act(async () => {
    fireEvent.click(tab('YAML'));
  });
}

async function chooseAgent(id: string) {
  await act(async () => {
    wrapper().findSelect()!.openDropdown();
  });
  const select = wrapper().findSelect()!;
  const index = select
    .findDropdown()
    .findOptions()
    .findIndex((option) => option.getElement().textContent?.startsWith(id));
  if (index < 0) throw new Error(`The agent ${id} is not offered.`);
  await act(async () => {
    select.selectOption(index + 1);
  });
}

async function checkNow(scheduler: FakeScheduler) {
  await act(async () => {
    scheduler.tick();
  });
  await act(async () => {});
}

async function typeInto(input: HTMLElement, value: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
}

describe('DesignView, the drawing', () => {
  // Each stage, and a stop mark where the end node used to be. One drawing
  // answers both: mounting the view again for the second would only draw the
  // same one.
  it('draws each stage of the workflow, the last ending in a stop mark', async () => {
    drawn();
    await settle();

    expect(screen.getByTestId('node-stage-draft')).toBeTruthy();
    expect(screen.getByTestId('node-stage-review')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'The run ends after review' }),
    ).toBeTruthy();
    expect(screen.queryByTestId('node-end')).toBeNull();
  });
});

describe('DesignView, the YAML tab', () => {
  it('shows the text of the workflow, which cannot be typed into yet', async () => {
    drawn();
    await settle();

    expect(panelOf('YAML').textContent).toContain('name: draft');
    expect(screen.getByTestId('raw-edit-note').textContent).toContain(
      'cannot be typed into here yet',
    );
  });

  // One answer says both where the check got to and which lines it names.
  it('says the text is valid and marks the lines of the picked stage', async () => {
    const { scheduler } = drawn();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await checkNow(scheduler);

    expect(screen.getByTestId('yaml-check-status').textContent).toContain(
      'The text is valid',
    );
    await openYaml();

    expect(panelOf('YAML').textContent).toContain('are stage drafting');
  });

  it('lists what the check found wrong with the text', async () => {
    const { scheduler } = drawn({ answers: [badAnswer] });
    await openProperties();
    await typeInto(nameInput(), 'Not A Name');
    await checkNow(scheduler);

    expect(screen.getByTestId('yaml-problems').textContent).toContain(
      'A stage name is lower case letters, digits and hyphens.',
    );
  });

  it('keeps the marks of the last good check while the text has problems', async () => {
    const { scheduler } = drawn({
      answers: [goodAnswer(HELLO_DOCUMENT.text ?? ''), badAnswer],
    });
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await checkNow(scheduler);
    await typeInto(nameInput(), 'Not A Name');
    await checkNow(scheduler);

    await openYaml();

    expect(panelOf('YAML').textContent).toContain('are stage Not A Name');
  });

  it('says so when the text could not be checked', async () => {
    const scheduler = new FakeScheduler();
    const validate = vi.fn(() =>
      Promise.reject(new Error('The check failed.')),
    );
    render(
      <Harness
        edits={acceptingEdits()}
        scheduler={scheduler}
        validate={validate}
      />,
    );
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await checkNow(scheduler);

    expect(screen.getByTestId('yaml-check-status').textContent).toContain(
      'The check failed.',
    );
  });
});

describe('DesignView, the Properties tab', () => {
  it('shows the keys that stage_fields names', async () => {
    drawn();
    await settle();

    await openProperties();

    const fields = within(panelOf('Properties')).getAllByRole('textbox');
    expect(fields).toHaveLength(3);
    expect(nameInput().value).toBe('draft');
  });

  it('shows no form when the workflow has no stage to pick', async () => {
    const empty: WorkflowDocument = {
      ...HELLO_DOCUMENT,
      view: { ...HELLO_DOCUMENT.view!, stages: [] },
    };
    drawn({ document: empty });
    await settle();

    expect(
      screen.getByText('Pick a stage in the drawing to edit its keys.'),
    ).toBeTruthy();
  });

  it('sends a new name to the editor, which draws it', async () => {
    drawn();
    await openProperties();

    await typeInto(nameInput(), 'drafting');

    expect(screen.getByTestId('node-stage-drafting')).toBeTruthy();
  });

  it('sends a new agent to the editor', async () => {
    drawn();
    await openProperties();

    await chooseAgent('k-architect');

    expect(
      within(screen.getByTestId('node-stage-draft')).getByTitle(
        'k-architect · kiro-cli',
      ),
    ).toBeTruthy();
  });

  // The keys of the file as it was loaded, and which of them can be edited:
  // the same form answers both.
  it('shows the keys the file has before anything is edited, the ones it cannot write read-only', async () => {
    drawn({ document: WITH_PROMPT });
    await settle();

    await openProperties();

    expect(promptInput().value).toBe('Write the greeting to README.md.');
    expect(nameInput().value).toBe('draft');
    expect(promptInput().readOnly).toBe(true);
    expect(panelOf('Properties').textContent).toContain(
      'edited in a later step',
    );
  });

  it('shows a prompt file the same way', async () => {
    drawn({ document: WITH_PROMPT_FILE });
    await settle();

    await openProperties();

    expect(
      (
        within(panelOf('Properties')).getByRole('textbox', {
          name: 'prompt_file',
        }) as HTMLInputElement
      ).value,
    ).toBe('review.md');
  });

  it('says while it is reading the keys of each stage', async () => {
    // The check of the loaded text is held, so the view stays in the state
    // this test is about and nothing settles behind the assertion.
    drawn({ document: WITH_PROMPT, openedHeld: true });
    await settle();

    expect(screen.getByTestId('reading-keys')).toBeTruthy();
  });

  it('says so when the keys could not be read', async () => {
    drawn({ document: WITH_PROMPT, openedFails: 'The server said no.' });
    await settle();

    expect(screen.getByTestId('reading-keys-failed').textContent).toContain(
      'The server said no.',
    );
  });

  it('leaves the name and the agent editable', async () => {
    drawn({ document: WITH_PROMPT });
    await settle();
    await openProperties();

    expect(nameInput().readOnly).toBe(false);
    await typeInto(nameInput(), 'drafting');

    expect(screen.getByTestId('node-stage-drafting')).toBeTruthy();
  });
});

describe('DesignView, undo and redo', () => {
  it('has nothing to undo before an edit', async () => {
    drawn();
    await settle();

    expect(isOff(button('Undo'))).toBe(true);
    expect(isOff(button('Redo'))).toBe(true);
  });

  // Redo only means anything after an undo, so the two steps are walked on
  // one draft rather than typed out twice.
  it('goes back to the text before the edit, and comes back to it with Redo', async () => {
    drawn();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.click(button('Undo'));
    });
    await openYaml();

    expect(panelOf('YAML').textContent).toContain('name: draft');
    expect(screen.getByTestId('earlier-text-note')).toBeTruthy();

    await act(async () => {
      fireEvent.click(button('Redo'));
    });

    expect(panelOf('YAML').textContent).toContain('name: drafting');
    expect(screen.queryByTestId('earlier-text-note')).toBeNull();
  });

  it('undoes on the keyboard shortcut', async () => {
    drawn();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.keyDown(nameInput(), { key: 'z', ctrlKey: true });
    });
    await openYaml();

    expect(panelOf('YAML').textContent).toContain('name: draft');
  });

  it('starts the history over when the page opens another workflow', async () => {
    const { open } = drawn();
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await open(OTHER_WORKFLOW);
    await settle();

    // The texts of the workflow that was left are gone with its draft.
    expect(isOff(button('Undo'))).toBe(true);
    await openYaml();
    expect(panelOf('YAML').textContent).toContain('name: package');
    expect(panelOf('YAML').textContent).not.toContain('drafting');
  });

  it('starts the history over for another workflow that reads the same', async () => {
    // Two workflows can hold the same bytes under the same name, so the
    // history goes by the load the page opened, not by what it reads.
    const { open } = drawn();
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await open({ ...HELLO_DOCUMENT });
    await settle();

    expect(isOff(button('Undo'))).toBe(true);
    await openYaml();
    expect(panelOf('YAML').textContent).not.toContain('drafting');
  });

  it('starts the history over for another workflow after a save that failed', async () => {
    const { open, edits, editorOf } = drawn();
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    const sent = textOf(editorOf().state);
    edits.save.mockRejectedValue(new Error('The server said no.'));
    await act(async () => {
      fireEvent.click(button('Save'));
    });
    await settle();

    // The workflow opened next holds the very text that save sent, which is
    // no reason to keep the history of the one it replaced.
    await open({ ...HELLO_DOCUMENT, text: sent, hash: 'e'.repeat(64) });
    await settle();

    expect(isOff(button('Undo'))).toBe(true);
    await openYaml();
    expect(panelOf('YAML').textContent).toContain('name: drafting');
    expect(screen.queryByTestId('earlier-text-note')).toBeNull();
  });

  it('keeps the history through a save of the same workflow', async () => {
    const { edits } = drawn();
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await act(async () => {
      fireEvent.click(button('Save'));
    });
    await settle();

    // The save gives the next version of the same file, with a new hash, and
    // the text it wrote is in the history already.
    expect(edits.save).toHaveBeenCalledTimes(1);
    expect(isOff(button('Undo'))).toBe(false);
  });

  it('leaves another key press to the browser', async () => {
    drawn();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.keyDown(nameInput(), { key: 'z' });
    });
    await openYaml();

    expect(panelOf('YAML').textContent).toContain('name: drafting');
  });
});

describe('DesignView, saving', () => {
  it('writes the text of the stages when Save is pressed', async () => {
    const { edits } = drawn();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    expect(edits.save).toHaveBeenCalledTimes(1);
    expect(edits.save.mock.calls[0]?.[0]).toContain('name: drafting');
  });

  it('says nothing until an edit, then refuses a save that would drop the prompt of the stage it changed', async () => {
    const { edits } = drawn({ document: WITH_PROMPT });
    await settle();

    // Nothing is refused while nothing is changed: the file is only a problem
    // once a save of it is on the table.
    expect(screen.queryByTestId('save-refused')).toBeNull();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    expect(edits.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('save-refused').textContent).toContain(
      'would drop the prompt of drafting',
    );
  });

  it('refuses a save that would drop a prompt file', async () => {
    const { edits } = drawn({ document: WITH_PROMPT_FILE });
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    expect(edits.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('save-refused').textContent).toContain(
      'prompt_file',
    );
  });

  it('refuses a save of a stage changed before the keys of the file are read', async () => {
    const { edits } = drawn({ document: WITH_PROMPT, openedHeld: true });
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    // The keys of the file are unknown, so the prompt it may hold is too.
    expect(edits.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('save-refused').textContent).toContain(
      'are not known',
    );
  });

  it('refuses a save of a stage changed when the keys could not be read', async () => {
    const { edits } = drawn({
      document: WITH_PROMPT,
      openedFails: 'The server said no.',
    });
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    expect(edits.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('save-refused').textContent).toContain(
      'are not known',
    );
  });

  it('refuses a save of the stage it renamed after another was added', async () => {
    const { edits } = drawn({ document: WITH_PROMPT });
    await settle();
    await act(async () => {
      fireEvent.click(button('Add agent-1'));
    });

    // The stage that was added is drawn under the name the button offered.
    expect(screen.getByTestId('node-stage-agent-1')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('node-stage-draft'));
    });
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    // Neither the count of the stages nor the name finds the stage the file
    // holds the prompt for; where it was loaded from does.
    expect(edits.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('save-refused').textContent).toContain(
      'would drop the prompt of drafting',
    );
  });

  it('lets a save of another stage with no other key go ahead', async () => {
    const { edits } = drawn({ document: WITH_PROMPT });
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId('node-stage-review'));
    });
    await openProperties();
    await typeInto(nameInput(), 'reviewing');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    expect(edits.save).toHaveBeenCalledTimes(1);
  });

  it('refuses every save of a file the writer would rewrite whole', async () => {
    const { edits } = drawn({ document: FLOW_STAGES });
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    // The params, the comments and the version of such a file would go.
    expect(edits.save).not.toHaveBeenCalled();
    const said = screen.getByTestId('save-refused').textContent ?? '';
    expect(said).toContain('write this whole file in the plain layout');
    expect(said).toContain('version');
  });

  it('says so before anything is edited in a file it would rewrite whole', async () => {
    drawn({ document: FLOW_STAGES });
    await settle();

    expect(screen.getByTestId('save-refused').textContent).toContain(
      'not a list under stages:',
    );
  });

  it('refuses a save of a stage whose file holds a comment inside it', async () => {
    const { edits } = drawn({ document: COMMENT_INSIDE });
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    expect(edits.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('save-refused').textContent).toContain(
      'the lines the file holds for it say more than that',
    );
  });

  it('refuses a save of a stage whose file holds a comment in front of it', async () => {
    const { edits } = drawn({ document: COMMENT_BEFORE });
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId('node-stage-review'));
    });
    await openProperties();
    await typeInto(nameInput(), 'reviewing');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    // The writer reads that comment as part of the stage that follows it.
    expect(edits.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('save-refused').textContent).toContain(
      'A comment, a blank line or a value not written plainly',
    );
  });

  it('lets a save go ahead for the stage the comment is not part of', async () => {
    const { edits } = drawn({ document: COMMENT_BEFORE });
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    expect(edits.save).toHaveBeenCalledTimes(1);
  });

  it('refuses a save of a stage renamed while a save of another was in flight', async () => {
    const { edits, editorOf } = drawn({ document: PROMPT_SECOND });
    await settle();
    // The answer of the save is held, so the draft moves on under it.
    let land: () => void = () => undefined;
    const sent = new Promise<void>((resolve) => {
      land = resolve;
    });
    edits.save.mockImplementation(async (text: string) => {
      await sent;
      return { hash: SAVED_HASH, view: viewOfText(text), diagnostics: [] };
    });
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    // The save of both stages goes out, the first is deleted while it is in
    // flight, and the answer lands with that edit on the page.
    await act(async () => {
      fireEvent.click(button('Save'));
    });
    await act(async () => {
      editorOf().remove('s1');
    });
    await act(async () => {
      land();
      await sent;
    });
    await settle();
    // The stage with the prompt is the one left. Renaming it must read the
    // place it has in the file that was written, which is the second, not the
    // place the deleted stage left behind.
    await openProperties();
    await typeInto(nameInput(), 'reviewing');

    edits.save.mockClear();
    await act(async () => {
      fireEvent.click(button('Save'));
    });

    expect(edits.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('save-refused').textContent).toContain(
      'would drop the prompt of reviewing',
    );
  });
});

describe('DesignView, what went wrong with a save', () => {
  const press = async (label: string) => {
    await act(async () => {
      fireEvent.click(button(label));
    });
  };

  /** Changes the name of the picked stage and presses Save. */
  const changeThenSave = async () => {
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await press('Save');
    await settle();
  };

  it('says why an ordinary save failed', async () => {
    const { edits } = drawn();
    edits.save.mockRejectedValue(new Error('The server said no.'));

    await changeThenSave();

    const alerts = screen.getByTestId('edit-alerts');
    expect(alerts.textContent).toContain('The workflow was not saved');
    expect(alerts.textContent).toContain('The server said no.');
  });

  it('says a save whose answer was lost may not have finished', async () => {
    const { edits } = drawn();
    edits.save.mockRejectedValue(new SaveLost('The answer was lost.'));
    edits.reload.mockRejectedValue(new Error('The file could not be read.'));

    await changeThenSave();

    expect(screen.getByTestId('edit-alerts').textContent).toContain(
      'The save did not finish',
    );
  });

  it('says when the server no longer knows the session', async () => {
    const { edits, scheduler } = drawn();
    edits.check.mockRejectedValue(new SessionLost('The session is gone.'));
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      scheduler.tick();
    });
    await settle();

    expect(screen.getByTestId('edit-alerts').textContent).toContain(
      'The session is lost',
    );
  });

  // One conflict, walked to its end: the offer to load the file again, the
  // load itself, and what is left of the draft after it. Each step needs the
  // one before it, so they are one draft rather than three of the same.
  it('offers to load the file again when it changed on disk, and says what became of the draft', async () => {
    const { edits } = drawn();
    edits.save.mockRejectedValue(
      new SaveConflict('The file changed.', 'c'.repeat(64)),
    );

    await changeThenSave();

    expect(screen.getByTestId('conflict')).toBeTruthy();
    expect(button('Load the file again')).toBeTruthy();

    await press('Load the file again');
    await settle();

    expect(edits.reload).toHaveBeenCalled();
    const discarded = screen.getByTestId('discarded');
    expect(discarded.textContent).toContain(
      'replaced by the file as it is now',
    );
    // The work that was replaced can still be taken away.
    expect(
      within(discarded).getByRole('button', { name: 'Copy my version' }),
    ).toBeTruthy();
  });
});

describe('DesignView, the agent of a stage', () => {
  const OTHERS = [
    { id: 'k-developer', summary: 'Writes code.' },
    { id: 'k-architect', summary: 'Designs systems.' },
  ];

  const agentOptionIds = () => {
    const select = wrapper().findSelect()!;
    return select
      .findDropdown()
      .findOptions()
      .map((option) => option.getElement().textContent ?? '');
  };

  it('keeps the agent the file names on offer after another is chosen, and takes it back', async () => {
    // The file names an agent that GET /api/agents no longer lists.
    drawn({ document: UNLISTED_AGENT, agents: OTHERS });
    await settle();
    await openProperties();

    await chooseAgent('k-architect');
    await act(async () => {
      wrapper().findSelect()!.openDropdown();
    });

    expect(agentOptionIds().join(' ')).toContain('k-legacy');

    // Still on offer means it can be chosen again, which is what it is for,
    // so it is taken from the list that was just read.
    const select = wrapper().findSelect()!;
    const legacy = select
      .findDropdown()
      .findOptions()
      .findIndex((option) =>
        option.getElement().textContent?.startsWith('k-legacy'),
      );
    await act(async () => {
      select.selectOption(legacy + 1);
    });

    expect(
      within(screen.getByTestId('node-stage-draft')).getByTitle(
        'k-legacy · kiro-cli',
      ),
    ).toBeTruthy();
  });
});

describe('DesignView, choosing a stage in the drawing', () => {
  const nodeOf = (name: string) =>
    screen.getByTestId(`node-stage-${name}`).parentElement!;

  it('opens the keys of a stage activated with the keyboard, with the focus in the first one', async () => {
    drawn();
    await settle();

    await act(async () => {
      fireEvent.keyDown(nodeOf('review'), { key: 'Enter' });
    });

    expect(panelOf('Properties').hidden).toBe(false);
    expect(nameInput().value).toBe('review');
    // A person who reached the drawing by keyboard goes on typing there.
    expect(document.activeElement).toBe(nameInput());
  });

  it('leaves the focus on the tab when the keyboard reaches Properties', async () => {
    drawn();
    await settle();
    // A stage was picked, so its keys were opened once and the focus moved.
    await act(async () => {
      fireEvent.keyDown(nodeOf('review'), { key: 'Enter' });
    });
    await openYaml();

    // The arrow keys walk the tabs, and the focus stays on the one reached.
    await act(async () => {
      fireEvent.keyDown(tab('YAML'), { key: 'ArrowRight' });
    });

    expect(panelOf('Properties').hidden).toBe(false);
    expect(document.activeElement).toBe(tab('Properties'));
  });

  it('opens the keys of the stage chosen with the pointer', async () => {
    drawn();
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByTestId('node-stage-review'));
    });

    expect(panelOf('Properties').hidden).toBe(false);
    // The stage that was clicked is the one the editor picked.
    expect(nameInput().value).toBe('review');
  });
});

describe('DesignView, many problems in the text', () => {
  const manyFindings = (count: number): CheckAnswer => ({
    errors: count,
    warnings: 0,
    infos: 0,
    view: null,
    diagnostics: Array.from({ length: count }, (_, index) => ({
      code: 'UNKNOWN_KEY',
      severity: 'error' as const,
      path: `stages[${index}]`,
      line: index + 1,
      column: 1,
      end_line: index + 1,
      end_column: 2,
      message: `Problem ${index + 1}.`,
    })),
  });

  const findingItems = () =>
    within(screen.getByTestId('yaml-problems')).getAllByRole('listitem');

  // One list of findings, asked for page by page to its end: a page at a
  // time, how many are left, and the limit the view stops at. Which findings
  // a page holds, and that the page count stops at the limit whatever the
  // server sends, are rules of `findingsPage` and `nextShown`, which
  // findings.test.ts puts 5,000 findings through without a view at all.
  it('shows a page of problems at a time, says how many are left, and stops at its own limit', async () => {
    const { scheduler } = drawn({ answers: [manyFindings(500)] });
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await checkNow(scheduler);

    expect(findingItems()).toHaveLength(FINDINGS_PER_PAGE);
    expect(screen.getByTestId('yaml-problems-left').textContent).toContain(
      '480 more problems',
    );

    await act(async () => {
      fireEvent.click(button(`Show ${FINDINGS_PER_PAGE} more`));
    });

    expect(findingItems()).toHaveLength(FINDINGS_PER_PAGE * 2);

    for (let page = 2; page * FINDINGS_PER_PAGE < FINDINGS_SHOWN_MOST; page++) {
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /^Show [\d,]+ more$/ }),
        );
      });
    }

    expect(findingItems()).toHaveLength(FINDINGS_SHOWN_MOST);
    expect(screen.getByTestId('yaml-problems-left').textContent).toContain(
      'Fix these and check again',
    );
  });

  it('shows every problem of a short list with nothing left', async () => {
    const { scheduler } = drawn({ answers: [manyFindings(3)] });
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await checkNow(scheduler);

    expect(findingItems()).toHaveLength(3);
    expect(screen.queryByTestId('yaml-problems-left')).toBeNull();
  });
});

describe('DesignView, a stage renamed to the name of another one', () => {
  // The keys and the lines both come from where the stage was loaded from,
  // so one rename answers for both.
  it('keeps the keys and the lines of the stage that is picked, not the one of that name', async () => {
    const { scheduler } = drawn({ document: WITH_PROMPT });
    await settle();
    await openProperties();

    await typeInto(nameInput(), 'review');

    expect(promptInput().value).toBe('Write the greeting to README.md.');

    await checkNow(scheduler);
    await openYaml();

    expect(panelOf('YAML').textContent).toContain('Lines 7 to 8 are stage');
  });
});
