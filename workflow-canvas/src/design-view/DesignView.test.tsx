// SPDX-License-Identifier: Apache-2.0
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useMemo } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { StageView, WorkflowDocument } from '../api/types';
import type { StageFieldRule } from '../designer-view/field-rules';
import type { CheckAnswer, ValidateRequest } from '../designer-view/yaml-draft';
import { useEditor, type Editor } from '../designer/use-editor';
import { MAX_STAGES, READ_ONLY_REASON, textOf } from '../designer/core';
import {
  SaveConflict,
  SaveLost,
  SaveRefused,
  SessionLost,
} from '../designer/core/ports';
import { oneCheck } from '../next-ui/one-check';
import { FakeScheduler } from '../test-support/fake-scheduler';
import {
  acceptingEdits,
  viewOfText,
  SAVED_HASH,
  type FakeEdits,
} from '../test-support/fake-edits';
import { HELLO_DOCUMENT, HELLO_TEXT, NO_RUNS } from '../test-support/fixtures';
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

// A comment inside the stage that is edited. The writer changes the bytes of
// the value it was asked to change and leaves the rest, so the comment stays.
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

// A comment in front of a later stage, which the writer keeps with that
// stage when it saves it.
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
    stages: [savedStage('package', 'k-developer')],
  },
};

// A file the stage writer cannot edit in place: its stages are a list in the
// flow form, so the writer refuses the save and the file is not written.
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
      savedStage('draft', 'k-legacy'),
      savedStage('review', 'k-quality-assurance', 1),
    ],
  },
};

// A stage of a saved view. The contract gives every stage a kind and the
// lines it takes up; a fixture that only cares about the name and the agent
// takes the kind of this release and a range past the head of the file.
function savedStage(name: string, agent: string, at = 0): StageView {
  return {
    name,
    kind: 'agent',
    agent,
    range: { line: 7 + at * 2, end_line: 8 + at * 2 },
  };
}

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
  useOneCheck = false,
  onEditor,
}: {
  document?: WorkflowDocument;
  edits: FakeEdits;
  scheduler: FakeScheduler;
  validate: (
    request: ValidateRequest,
    signal: AbortSignal,
  ) => Promise<CheckAnswer>;
  stageFields?: StageFieldsByKind;
  agents?: readonly { readonly id: string; readonly summary: string }[];
  useOneCheck?: boolean;
  /** Hands the editor to the test, which other views of the page also hold. */
  onEditor?: (editor: Editor) => void;
}) {
  const checks = useMemo(
    () => oneCheck(validate, workflow.name),
    [validate, workflow.name],
  );
  const editorEdits = useMemo(
    () => (useOneCheck ? { ...edits, check: checks.check } : edits),
    [checks.check, edits, useOneCheck],
  );
  const workflowRef = useMemo(
    () => ({
      harness: 'kiro-cli',
      document: workflow,
      edits: editorEdits,
      runs: NO_RUNS,
    }),
    [workflow, editorEdits],
  );
  const editor = useEditor(workflowRef, scheduler);
  if (editor) onEditor?.(editor);
  if (!editor) return null;
  return (
    <DesignView
      editor={editor}
      loaded={workflowRef}
      harness="kiro-cli"
      validate={useOneCheck ? checks.validate : validate}
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
  openedRecovers = false,
  openedHeld = false,
  agents,
  useOneCheck = false,
}: {
  document?: WorkflowDocument;
  /** The answers of the checks that follow an edit, in order. */
  answers?: CheckAnswer[];
  /** The check of the loaded text fails with this message. */
  openedFails?: string;
  /** Only the first check of the loaded text fails; a later one answers. */
  openedRecovers?: boolean;
  /** The check of the loaded text never answers, as one in flight. */
  openedHeld?: boolean;
  /** The agents on offer for the `agent` key. */
  agents?: readonly { readonly id: string; readonly summary: string }[];
  useOneCheck?: boolean;
} = {}) {
  const scheduler = new FakeScheduler();
  const edits = acceptingEdits();
  const queued = [...(answers ?? [])];
  const savedText = workflow.text ?? '';
  let openedTries = 0;
  // The check of the text as loaded is its own call; the queued answers are
  // for the checks that follow an edit.
  const validate = vi.fn(async (request: ValidateRequest) => {
    if (request.text === savedText) {
      openedTries += 1;
      if (openedHeld) return new Promise<CheckAnswer>(() => undefined);
      const stillFails = !openedRecovers || openedTries === 1;
      if (openedFails !== undefined && stillFails) {
        throw new Error(openedFails);
      }
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
      useOneCheck={useOneCheck}
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
  // Each stage, and a stop mark on the one the run ends after. One drawing
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
  });
});

describe('DesignView, a read-only workflow', () => {
  it('keeps every workflow control read-only and says why', async () => {
    drawn({ document: { ...HELLO_DOCUMENT, readOnly: true } });
    await settle();

    expect(screen.getByTestId('read-only-note').textContent).toContain(
      READ_ONLY_REASON,
    );
    await openProperties();

    expect(nameInput().readOnly).toBe(true);
    expect(promptInput().readOnly).toBe(true);
    expect(
      wrapper()
        .findSelect()!
        .findTrigger()
        .getElement()
        .hasAttribute('disabled'),
    ).toBe(true);

    const controls = ['Save', 'Delete stage'];
    const add = screen.getByRole('button', { name: /^Add / });
    expect(isOff(add)).toBe(true);
    for (const label of controls) expect(isOff(button(label))).toBe(true);

    for (const control of [add, ...controls.map(button)]) {
      await act(async () => control.focus());
      const cloudscape = wrapper()
        .findAllButtons()
        .find((one) => one.getElement() === control);
      expect(
        cloudscape?.findDisabledReason()?.getElement().textContent,
      ).toContain(READ_ONLY_REASON);
    }

    await openYaml();
    const yaml = screen.getByTestId('yaml-text') as HTMLTextAreaElement;
    expect(yaml.readOnly).toBe(true);
    expect(panelOf('YAML').textContent).toContain(READ_ONLY_REASON);
  });

  it('keeps history controls off when a reload makes the workflow read-only', async () => {
    const { edits, editorOf } = drawn();
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await settle();

    edits.reload.mockResolvedValue({ ...HELLO_DOCUMENT, readOnly: true });
    await act(async () => {
      editorOf().reload();
    });
    await settle();

    for (const label of ['Undo', 'Redo']) {
      const control = button(label);
      expect(isOff(control)).toBe(true);
      await act(async () => control.focus());
      const cloudscape = wrapper()
        .findAllButtons()
        .find((one) => one.getElement() === control);
      expect(
        cloudscape?.findDisabledReason()?.getElement().textContent,
      ).toContain(READ_ONLY_REASON);
    }

    await openYaml();
    const yaml = screen.getByTestId('yaml-text') as HTMLTextAreaElement;
    expect(yaml.value).toBe(HELLO_TEXT);

    for (const label of ['Undo', 'Redo']) {
      await act(async () => {
        fireEvent.click(button(label));
      });
      expect(yaml.value).toBe(HELLO_TEXT);
    }

    for (const modifiers of [
      { ctrlKey: true },
      { metaKey: true },
      { ctrlKey: true, shiftKey: true },
      { metaKey: true, shiftKey: true },
    ]) {
      await act(async () => {
        fireEvent.keyDown(yaml, { key: 'z', ...modifiers });
      });
      expect(yaml.value).toBe(HELLO_TEXT);
    }
  });
});

describe('DesignView, the YAML tab', () => {
  it('shows the text of the workflow in a box that can be typed into', async () => {
    drawn();
    await settle();

    const box = screen.getByTestId('yaml-text') as HTMLTextAreaElement;
    expect(box.value).toBe(HELLO_TEXT);
    expect(box.disabled).toBe(false);
    expect(panelOf('YAML').textContent).toContain(
      'Type to change the whole file',
    );
    expect(screen.queryByTestId('stage-keys-frozen')).toBeNull();
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

  it('deletes the first stage, selects the next one and moves focus to its name', async () => {
    drawn();
    await openProperties();

    await act(async () => {
      fireEvent.click(button('Delete stage'));
    });

    expect(screen.queryByTestId('node-stage-draft')).toBeNull();
    expect(nameInput().value).toBe('review');
    expect(document.activeElement).toBe(nameInput());
    expect(screen.getByTestId('designer-live').textContent).toBe(
      'Stage draft deleted.',
    );
    expect(isOff(button('Delete stage'))).toBe(true);
  });

  it('selects the stage before one deleted later in the workflow', async () => {
    drawn();
    await act(async () => {
      fireEvent.click(screen.getByTestId('node-stage-review'));
    });

    await act(async () => {
      fireEvent.click(button('Delete stage'));
    });

    expect(screen.queryByTestId('node-stage-review')).toBeNull();
    expect(nameInput().value).toBe('draft');
    expect(document.activeElement).toBe(nameInput());
    expect(screen.getByTestId('designer-live').textContent).toBe(
      'Stage review deleted.',
    );
  });

  // The keys of the file as it was loaded, and which of them can be edited:
  // the same form answers both.
  it('shows the keys the file has before anything is edited and leaves writable keys editable', async () => {
    drawn({ document: WITH_PROMPT });
    await settle();

    await openProperties();

    expect(promptInput().value).toBe('Write the greeting to README.md.');
    expect(nameInput().value).toBe('draft');
    expect(promptInput().readOnly).toBe(false);
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

  it('says so when the keys could not be read, and how to read them again', async () => {
    drawn({ document: WITH_PROMPT, openedFails: 'The server said no.' });
    await settle();
    const said = screen.getByTestId('reading-keys-failed').textContent ?? '';

    expect(said).toContain('The server said no.');
    expect(said).toContain(
      'The name, the agent and any prompt the editor can read are still there to change',
    );
  });

  // The warning names the prompt because the editor finds it in the file
  // itself, so a failed check does not take it off the page.
  it('still takes a prompt after the first check failed', async () => {
    const { edits } = drawn({
      document: WITH_PROMPT,
      openedFails: 'The server said no.',
    });
    await settle();
    await openProperties();

    expect(promptInput().readOnly).toBe(false);
    await typeInto(promptInput(), 'Write it twice.');
    await act(async () => {
      fireEvent.click(button('Save'));
    });
    await settle();

    expect(edits.save).toHaveBeenCalledWith(
      expect.stringContaining('prompt: Write it twice.'),
      WITH_PROMPT.hash,
    );
  });

  // The writer reads the file's own bytes, not the check, so a check that
  // could not be made costs the keys on show and nothing else.
  it('saves after a failed first check, keeping the keys it could not read', async () => {
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

    expect(screen.queryByTestId('save-refused')).toBeNull();
    expect(edits.save).toHaveBeenCalledTimes(1);
    const written = edits.save.mock.calls[0]?.[0] ?? '';
    expect(written).toContain('name: drafting');
    expect(written).toContain('prompt: Write the greeting to README.md.');
  });

  it('reads the keys again on Check again, and the save still goes ahead', async () => {
    // The default file, whose stages hold the name and the agent only, so the
    // keys the check brings back are the two the form can type in.
    const { edits } = drawn({
      openedFails: 'The server said no.',
      openedRecovers: true,
    });
    await settle();
    expect(screen.getByTestId('reading-keys-failed')).toBeTruthy();

    await act(async () => {
      fireEvent.click(button('Check again'));
    });
    await settle();

    expect(screen.queryByTestId('reading-keys-failed')).toBeNull();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    expect(screen.queryByTestId('save-refused')).toBeNull();

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    expect(edits.save).toHaveBeenCalledTimes(1);
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
    expect(screen.getByTestId('earlier-text-note').textContent).toContain(
      'current stage edits, which Save writes',
    );

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
    await open({ ...HELLO_DOCUMENT, text: sent ?? null, hash: 'e'.repeat(64) });
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

  it('says nothing until an edit, then keeps the prompt of the stage it changed', async () => {
    const { edits } = drawn({ document: WITH_PROMPT });
    await settle();

    expect(screen.queryByTestId('save-refused')).toBeNull();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    // The writer replaces the bytes of the value it was asked to change and
    // leaves every other byte of the item, the prompt among them.
    expect(screen.queryByTestId('save-refused')).toBeNull();
    const written = edits.save.mock.calls[0]?.[0] ?? '';
    expect(written).toContain('name: drafting');
    expect(written).toContain('prompt: Write the greeting to README.md.');
  });

  it('keeps a prompt file through a save', async () => {
    const { edits } = drawn({ document: WITH_PROMPT_FILE });
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    const written = edits.save.mock.calls[0]?.[0] ?? '';
    expect(written).toContain('name: drafting');
    expect(written).toContain('prompt_file: review.md');
  });

  it('saves a stage changed before the keys of the file are read', async () => {
    const { edits } = drawn({ document: WITH_PROMPT, openedHeld: true });
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    // The keys on show are unknown while that check is out, but the writer
    // works from the file, so the prompt it holds is kept all the same.
    expect(screen.queryByTestId('save-refused')).toBeNull();
    const written = edits.save.mock.calls[0]?.[0] ?? '';
    expect(written).toContain('prompt: Write the greeting to README.md.');
  });

  it('keeps the prompt of a stage renamed after another was added', async () => {
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

    // Neither the count of the stages nor the name finds the item the file
    // holds the prompt in; the place the stage was loaded from does.
    expect(screen.queryByTestId('save-refused')).toBeNull();
    const written = edits.save.mock.calls[0]?.[0] ?? '';
    expect(written).toContain('name: drafting');
    expect(written).toContain('prompt: Write the greeting to README.md.');
    expect(written).toContain('name: agent-1');
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

  it('refuses every save of a file whose stages the writer cannot edit in place', async () => {
    const { edits } = drawn({ document: FLOW_STAGES });
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    await act(async () => {
      fireEvent.click(button('Save'));
    });

    // A list in the flow form has no item the writer can edit, so it says so
    // rather than writing the file again and losing its params and comments.
    expect(edits.save).not.toHaveBeenCalled();
    const said = screen.getByTestId('save-refused').textContent ?? '';
    expect(said).toContain('written in brackets');
    expect(said).toContain('text editor');
  });

  it('says so before anything is edited in such a file', async () => {
    drawn({ document: FLOW_STAGES });
    await settle();

    expect(screen.getByTestId('save-refused').textContent).toContain(
      'written in brackets',
    );
  });

  it('keeps a comment inside the stage it changed', async () => {
    const { edits } = drawn({ document: COMMENT_INSIDE });
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');

    expect(screen.queryByTestId('save-refused')).toBeNull();
    await act(async () => {
      fireEvent.click(button('Save'));
    });

    const written = edits.save.mock.calls[0]?.[0] ?? '';
    expect(written).toContain('name: drafting');
    expect(written).toContain('# The one that writes it.');
  });

  it('keeps a comment in front of the stage it changed', async () => {
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

    // The writer reads that comment as part of the stage that follows it and
    // moves it with that stage, so it is still in the file.
    expect(screen.queryByTestId('save-refused')).toBeNull();
    const written = edits.save.mock.calls[0]?.[0] ?? '';
    expect(written).toContain('name: reviewing');
    expect(written).toContain('# The one that checks it.');
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

    // The stage with the prompt is the one left, and its place in the file
    // that was written is the first, not the one the deleted stage left
    // behind, so the writer edits that item and the prompt stays with it.
    expect(edits.save).toHaveBeenCalledTimes(1);
    const written = edits.save.mock.calls[0]?.[0] ?? '';
    expect(written).toContain('name: reviewing');
    expect(written).toContain('prompt: Check the greeting.');
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

  const saveOnlyFinding = {
    message: 'The saved name is not allowed.',
    path: 'stages[0].name',
    line: 7,
    severity: 'error',
  } as const;

  const expectSaveState = (status: string, disabled: boolean) => {
    expect(screen.getByTestId('save-status').textContent).toContain(status);
    expect(isOff(button('Save'))).toBe(disabled);
  };

  const expectFindings = (...messages: string[]) => {
    const list = screen.getByTestId('yaml-problems');
    for (const message of messages) expect(list.textContent).toContain(message);
  };

  const expectNoFindings = () => {
    expect(screen.queryByTestId('yaml-problems')).toBeNull();
  };

  const startFromRefusedSave = async (edits: FakeEdits) => {
    edits.save.mockRejectedValueOnce(
      new SaveRefused('The workflow has errors.', [saveOnlyFinding]),
    );

    await changeThenSave();

    expectFindings(saveOnlyFinding.message);
    expectSaveState('Unsaved changes', true);
  };

  it('says why an ordinary save failed', async () => {
    const { edits } = drawn();
    edits.save.mockRejectedValue(new Error('The server said no.'));

    await changeThenSave();

    const alerts = screen.getByTestId('edit-alerts');
    expect(alerts.textContent).toContain('The workflow was not saved');
    expect(alerts.textContent).toContain('The server said no.');
  });

  it('shows the findings of a refused save until the draft changes', async () => {
    const { edits } = drawn();
    edits.save.mockRejectedValue(
      new SaveRefused('The workflow has errors.', [
        {
          message: 'The saved name is not allowed.',
          path: 'stages[0].name',
          line: 7,
          severity: 'error',
        },
        {
          message: 'The workflow has an unsupported combination.',
          path: '',
          line: undefined,
          severity: 'error',
        },
      ]),
    );

    await changeThenSave();

    const problems = screen.getByTestId('yaml-problems');
    expect(problems.textContent).toContain(
      'Line 7: The saved name is not allowed.',
    );
    expect(problems.textContent).toContain(
      'The workflow has an unsupported combination.',
    );
    expect(problems.textContent).not.toContain('Line undefined');

    await typeInto(nameInput(), 'drafting-again');

    expect(screen.queryByTestId('yaml-problems')).toBeNull();
  });

  it('lists a finding once when the check and refused save report it', async () => {
    const { edits, scheduler } = drawn({ answers: [badAnswer] });
    const finding = {
      message: badAnswer.diagnostics[0]!.message,
      path: badAnswer.diagnostics[0]!.path,
      line: badAnswer.diagnostics[0]!.line,
      severity: badAnswer.diagnostics[0]!.severity,
    } as const;
    edits.save.mockRejectedValue(
      new SaveRefused('The workflow has errors.', [finding]),
    );
    edits.check.mockImplementation(() => new Promise(() => undefined));

    await changeThenSave();
    await checkNow(scheduler);

    expect(
      within(screen.getByTestId('yaml-problems')).getAllByRole('listitem'),
    ).toHaveLength(1);
  });

  it('lists a refused-save finding only while YAML shows the text that was refused', async () => {
    const { edits } = drawn();
    await startFromRefusedSave(edits);

    await press('Undo');
    await settle();

    expect(screen.getByTestId('earlier-text-note')).toBeTruthy();
    expectNoFindings();
    expectSaveState('Unsaved changes', true);
    const save = button('Save');
    await act(async () => save.focus());
    expect(
      wrapper()
        .findAllButtons()
        .find((one) => one.getElement() === save)
        ?.findDisabledReason()
        ?.getElement().textContent,
    ).toContain('Fix the problems in the workflow first.');

    await press('Redo');
    await settle();

    expectFindings(saveOnlyFinding.message);
    expectSaveState('Unsaved changes', true);
  });

  it('replaces a refused-save finding when a later check reports a different one', async () => {
    const { edits, scheduler } = drawn();
    await startFromRefusedSave(edits);
    edits.check.mockResolvedValue({
      view: HELLO_DOCUMENT.view,
      diagnostics: [
        {
          message: 'The live check found another problem.',
          path: 'stages[0].agent',
          line: 8,
          severity: 'error',
        },
      ],
    });

    await typeInto(nameInput(), 'drafting-again');
    await checkNow(scheduler);

    expectFindings('The live check found another problem.');
    expect(screen.getByTestId('yaml-problems').textContent).not.toContain(
      saveOnlyFinding.message,
    );
    expectSaveState('Unsaved changes', true);
  });

  it('clears a refused-save finding when a later check finds none', async () => {
    const { edits, scheduler } = drawn();
    await startFromRefusedSave(edits);

    await typeInto(nameInput(), 'drafting-again');
    await checkNow(scheduler);

    expectNoFindings();
    expectSaveState('Unsaved changes', false);
  });

  it('keeps a refused-save finding when unchanged text has a cached clean answer', async () => {
    const { edits, scheduler, validate } = drawn({ useOneCheck: true });
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await checkNow(scheduler);
    edits.save.mockRejectedValueOnce(
      new SaveRefused('The workflow has errors.', [saveOnlyFinding]),
    );

    await press('Save');
    await settle();
    await checkNow(scheduler);

    expectFindings(saveOnlyFinding.message);
    expectSaveState('Unsaved changes', true);
    expect(
      validate.mock.calls.filter(([request]) =>
        request.text.includes('name: drafting'),
      ),
    ).toHaveLength(1);
  });

  it('clears a refused-save finding when the same workflow is loaded again', async () => {
    const { edits, editorOf } = drawn();
    await startFromRefusedSave(edits);

    await act(async () => {
      editorOf().reload();
    });
    await settle();

    expectNoFindings();
    expectSaveState('Loaded again from the server', true);
  });

  it('clears a refused-save finding when another workflow is opened', async () => {
    const { edits, open } = drawn();
    await startFromRefusedSave(edits);

    await open(OTHER_WORKFLOW);
    await settle();

    expectNoFindings();
    expectSaveState('No changes', true);
  });

  it('clears a refused-save finding when a reload makes the workflow read-only', async () => {
    const { edits, editorOf } = drawn();
    await startFromRefusedSave(edits);
    edits.reload.mockResolvedValue({ ...HELLO_DOCUMENT, readOnly: true });

    await act(async () => {
      editorOf().reload();
    });
    await settle();

    expectNoFindings();
    expectSaveState('Loaded again from the server', true);
  });

  it('keeps a refused-save finding cleared while a later save is in flight', async () => {
    const { edits, scheduler } = drawn();
    await startFromRefusedSave(edits);
    await typeInto(nameInput(), 'drafting-again');
    await checkNow(scheduler);
    edits.save.mockImplementation(() => new Promise(() => undefined));

    await press('Save');

    expectNoFindings();
    expectSaveState('Saving', true);
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
      tab('YAML').focus();
      fireEvent.keyDown(tab('YAML'), { key: 'ArrowRight', keyCode: 39 });
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

    // The contract's range covers every line of the item, the prompt included.
    expect(panelOf('YAML').textContent).toContain('Lines 7 to 9 are stage');
  });
});

describe('DesignView, typing over the whole text', () => {
  const TYPED = `${HELLO_TEXT}# typed over\n`;

  const yamlBox = () => screen.getByTestId('yaml-text') as HTMLTextAreaElement;

  const press = async (label: string) => {
    await act(async () => {
      fireEvent.click(button(label));
    });
  };

  /** Types `text` into the YAML box and lets the view settle. */
  const typeText = async (text: string) => {
    await settle();
    await typeInto(yamlBox(), text);
    await settle();
  };

  it('shows what was typed and says the keys of a stage are frozen', async () => {
    drawn();

    await typeText(TYPED);

    expect(yamlBox().value).toBe(TYPED);
    expect(screen.getByTestId('stage-keys-frozen').textContent).toContain(
      'typed over',
    );
    expect(screen.getByTestId('save-status').textContent).toContain(
      'Unsaved changes',
    );
  });

  it('keeps the keys of a stage read-only while it is pending', async () => {
    drawn();

    await typeText(TYPED);
    await openProperties();

    expect(nameInput().readOnly).toBe(true);
    const add = screen.getByRole('button', {
      name: /^Add /,
    }) as HTMLButtonElement;
    expect(isOff(add)).toBe(true);
  });

  it('saves that text as it stands, on the hash of the file', async () => {
    const { edits } = drawn();

    await typeText(TYPED);
    await press('Save');
    await settle();

    expect(edits.save).toHaveBeenCalledWith(TYPED, HELLO_DOCUMENT.hash);
    expect(screen.getByTestId('save-status').textContent).toContain('Saved');
    expect(screen.queryByTestId('stage-keys-frozen')).toBeNull();
  });

  it('offers to load the file again when it changed under a raw edit', async () => {
    const { edits } = drawn();
    edits.save.mockRejectedValue(
      new SaveConflict('The file changed.', 'c'.repeat(64)),
    );

    await typeText(TYPED);
    await press('Save');
    await settle();

    expect(screen.getByTestId('conflict')).toBeTruthy();
    expect(button('Load the file again')).toBeTruthy();
    expect(yamlBox().value).toBe(TYPED);
  });

  it('takes a key of a stage again once the raw text is saved', async () => {
    const { edits } = drawn();

    await typeText(TYPED);
    await press('Save');
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await press('Save');
    await settle();

    expect(edits.save).toHaveBeenLastCalledWith(
      expect.stringContaining('name: drafting'),
      SAVED_HASH,
    );
  });

  it('steps back to the text before the raw edit with Undo, and forward with Redo', async () => {
    drawn();

    await typeText(TYPED);
    await press('Undo');
    await settle();

    expect(yamlBox().value).toBe(HELLO_TEXT);
    expect(screen.queryByTestId('earlier-text-note')).toBeNull();
    expect(screen.queryByTestId('stage-keys-frozen')).toBeNull();

    await press('Redo');
    await settle();

    expect(yamlBox().value).toBe(TYPED);
  });

  it('saves the text shown after Undo and Redo over a raw edit', async () => {
    const { edits } = drawn();
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await settle();
    const beforeRaw = yamlBox().value;
    const typed = `${beforeRaw}# typed over\n`;

    await typeText(typed);
    await act(async () => {
      fireEvent.keyDown(yamlBox(), { key: 'z', ctrlKey: true });
    });
    await settle();

    expect(yamlBox().value).toBe(beforeRaw);
    await press('Save');
    await settle();
    expect(edits.save).toHaveBeenLastCalledWith(
      yamlBox().value,
      HELLO_DOCUMENT.hash,
    );

    await act(async () => {
      fireEvent.keyDown(yamlBox(), {
        key: 'z',
        ctrlKey: true,
        shiftKey: true,
      });
    });
    await settle();
    const redone = yamlBox().value;
    expect(redone).toBe(typed);
    await press('Save');
    await settle();

    expect(edits.save).toHaveBeenLastCalledWith(redone, SAVED_HASH);
  });

  it('saves the text shown after two Undos that start from a raw edit over an earlier text', async () => {
    const { edits } = drawn();
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await settle();
    await typeInto(nameInput(), 'drafted');
    await settle();
    await press('Undo');
    await settle();
    const earlier = yamlBox().value;

    await typeText(`${earlier}# typed over\n`);
    await settle();
    for (let step = 0; step < 2; step += 1) {
      await act(async () => {
        fireEvent.keyDown(yamlBox(), { key: 'z', ctrlKey: true });
      });
      await settle();
    }

    expect(yamlBox().value).toBe(HELLO_TEXT);
    expect(screen.queryByTestId('earlier-text-note')).toBeNull();
    await press('Save');
    await settle();
    expect(edits.save).toHaveBeenLastCalledWith(
      HELLO_TEXT,
      HELLO_DOCUMENT.hash,
    );
  });

  it('saves the text shown after Redo back over the same chain', async () => {
    const { edits } = drawn();
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await settle();
    await typeInto(nameInput(), 'drafted');
    await settle();
    await press('Undo');
    await settle();
    const earlier = yamlBox().value;
    const typed = `${earlier}# typed over\n`;
    await typeText(typed);
    await settle();
    await press('Undo');
    await settle();
    await press('Undo');
    await settle();

    await press('Redo');
    await settle();
    expect(yamlBox().value).toBe(earlier);
    expect(screen.queryByTestId('earlier-text-note')).toBeNull();

    await press('Redo');
    await settle();
    expect(yamlBox().value).toBe(typed);
    await press('Save');
    await settle();
    expect(edits.save).toHaveBeenLastCalledWith(typed, HELLO_DOCUMENT.hash);
  });

  it('steps back over a key of a stage and then over a raw edit', async () => {
    drawn();

    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await settle();
    const afterForm = yamlBox().value;
    expect(afterForm).toContain('name: drafting');

    await typeText(`${afterForm}# typed over\n`);
    await press('Undo');
    await settle();

    expect(yamlBox().value).toBe(afterForm);

    await press('Undo');
    await settle();

    expect(yamlBox().value).toBe(HELLO_TEXT);
  });

  it('adopts the text that Undo shows when it is typed into again', async () => {
    drawn();

    await typeText(TYPED);
    await press('Undo');
    await settle();
    await typeText(`${HELLO_TEXT}# another\n`);

    expect(yamlBox().value).toBe(`${HELLO_TEXT}# another\n`);
    expect(screen.queryByTestId('earlier-text-note')).toBeNull();
  });
});

describe('DesignView, the prompt of a stage', () => {
  const press = async (label: string) => {
    await act(async () => {
      fireEvent.click(button(label));
    });
  };

  it('types a prompt, which the text shows at once', async () => {
    drawn({ document: WITH_PROMPT });
    await settle();
    await openProperties();

    await typeInto(promptInput(), 'Write it twice.');

    expect(promptInput().value).toBe('Write it twice.');
    expect(
      (screen.getByTestId('yaml-text') as HTMLTextAreaElement).value,
    ).toContain('Write it twice.');
    expect(screen.getByTestId('save-status').textContent).toContain(
      'Unsaved changes',
    );
  });

  it('saves the typed prompt through the writer of the file', async () => {
    const { edits } = drawn({ document: WITH_PROMPT });
    await settle();
    await openProperties();

    await typeInto(promptInput(), 'Write it twice.');
    await press('Save');
    await settle();

    expect(edits.save).toHaveBeenCalledWith(
      expect.stringContaining('prompt: Write it twice.'),
      WITH_PROMPT.hash,
    );
    expect(screen.getByTestId('save-status').textContent).toContain('Saved');
  });

  it('keeps the other keys of the stage as they were', async () => {
    const { edits } = drawn({ document: WITH_PROMPT });
    await settle();
    await openProperties();

    await typeInto(promptInput(), 'Write it twice.');
    await press('Save');
    await settle();

    const [written] = edits.save.mock.calls[0] ?? [];
    expect(written).toContain('name: draft');
    expect(written).toContain('agent: k-developer');
    expect(written).toContain('name: review');
  });

  it('keeps a prompt read-only when the stage reads a file', async () => {
    drawn({ document: WITH_PROMPT_FILE });
    await settle();
    await openProperties();

    expect(promptInput().readOnly).toBe(true);
    expect(
      (
        within(panelOf('Properties')).getByRole('textbox', {
          name: 'prompt_file',
        }) as HTMLInputElement
      ).readOnly,
    ).toBe(true);
  });

  it('steps back over a typed prompt with Undo', async () => {
    drawn({ document: WITH_PROMPT });
    await settle();
    await openProperties();
    const before = (screen.getByTestId('yaml-text') as HTMLTextAreaElement)
      .value;

    await typeInto(promptInput(), 'Write it twice.');
    await press('Undo');
    await settle();

    expect((screen.getByTestId('yaml-text') as HTMLTextAreaElement).value).toBe(
      before,
    );
  });
});

describe('DesignView, saving while the text is typed over', () => {
  const TYPED = `${HELLO_TEXT}# typed over\n`;

  const yamlBox = () => screen.getByTestId('yaml-text') as HTMLTextAreaElement;

  const press = async (label: string) => {
    await act(async () => {
      fireEvent.click(button(label));
    });
  };

  const addButton = () =>
    wrapper()
      .findAllButtons()
      .find((one) => /^Add /.test(one.getElement().textContent ?? ''))!;

  it('says why Add is off while the text is typed over', async () => {
    drawn();
    await settle();

    await typeInto(yamlBox(), TYPED);
    await settle();

    await act(async () => {
      addButton().focus();
    });
    expect(
      addButton().findDisabledReason()?.getElement().textContent,
    ).toContain('typed over');
  });

  it('says the stage limit when that is why Add is off', async () => {
    const { editorOf } = drawn();
    await settle();
    await act(async () => {
      for (let n = 0; n < MAX_STAGES; n += 1) editorOf().add();
    });
    await settle();

    await act(async () => {
      addButton().focus();
    });
    expect(
      addButton().findDisabledReason()?.getElement().textContent,
    ).toContain('at most');
  });

  // One save held open, walked through: the box refuses typing while it runs,
  // and shows what the file holds once the answer has come.
  const heldSave = (edits: FakeEdits) => {
    let finish: (text: string) => void = () => {};
    edits.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = (written: string) =>
            resolve({
              hash: SAVED_HASH,
              view: viewOfText(written),
              diagnostics: [],
            });
        }),
    );
    return () => finish;
  };

  it('refuses typing while a form save is in flight, and says why', async () => {
    const { edits } = drawn();
    const held = heldSave(edits);
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await settle();
    const sent = yamlBox().value;
    await press('Save');

    expect(yamlBox().readOnly).toBe(true);
    expect(panelOf('YAML').textContent).toContain('typing is paused');
    await typeInto(yamlBox(), TYPED);

    expect(yamlBox().value).toBe(sent);

    await act(async () => {
      held()(sent);
    });
    await settle();

    expect(yamlBox().readOnly).toBe(false);
    expect(yamlBox().value).toBe(sent);
    expect(screen.getByTestId('save-status').textContent).toContain('Saved');
  });

  it('refuses typing while a raw save is in flight, and says why', async () => {
    const { edits } = drawn();
    const held = heldSave(edits);
    await settle();
    await typeInto(yamlBox(), TYPED);
    await settle();
    await press('Save');

    expect(yamlBox().readOnly).toBe(true);
    expect(isOff(button('Undo'))).toBe(true);
    await typeInto(yamlBox(), `${TYPED}# newer\n`);
    await typeInto(yamlBox(), HELLO_TEXT);

    expect(yamlBox().value).toBe(TYPED);

    await act(async () => {
      held()(TYPED);
    });
    await settle();

    expect(edits.save).toHaveBeenCalledWith(TYPED, HELLO_DOCUMENT.hash);
    expect(yamlBox().value).toBe(TYPED);
    expect(screen.getByTestId('save-status').textContent).toContain('Saved');
  });

  it('keeps Undo off while a raw save runs on a text that Undo adopted', async () => {
    const { edits } = drawn();
    const held = heldSave(edits);
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await settle();
    await typeInto(nameInput(), 'drafted');
    await settle();
    await press('Undo');
    await settle();
    const earlier = yamlBox().value;
    await typeInto(yamlBox(), `${earlier}# typed over\n`);
    await settle();
    await press('Undo');
    await settle();
    expect(yamlBox().value).toBe(earlier);

    await press('Save');

    expect(isOff(button('Undo'))).toBe(true);
    await act(async () => {
      fireEvent.keyDown(yamlBox(), { key: 'z', ctrlKey: true });
    });
    await settle();
    expect(yamlBox().value).toBe(earlier);
    expect(edits.save).toHaveBeenLastCalledWith(earlier, HELLO_DOCUMENT.hash);

    await act(async () => {
      held()(earlier);
    });
    await settle();
    expect(yamlBox().value).toBe(earlier);
  });

  it('keeps the blocked box reachable, so its text can be read and copied', async () => {
    const { edits } = drawn();
    heldSave(edits);
    await settle();
    await typeInto(yamlBox(), TYPED);
    await settle();
    await press('Save');

    const box = yamlBox();
    expect(box.readOnly).toBe(true);
    expect(box.hasAttribute('disabled')).toBe(false);
    await act(async () => {
      box.focus();
    });
    expect(document.activeElement).toBe(box);
    box.setSelectionRange(0, box.value.length);
    expect(box.value.slice(box.selectionStart, box.selectionEnd)).toBe(TYPED);
  });

  it('keeps the raw text to save again when the save fails', async () => {
    const { edits } = drawn();
    edits.save.mockRejectedValue(new Error('The server said no.'));
    await settle();
    await typeInto(yamlBox(), TYPED);
    await settle();
    await press('Save');
    await settle();

    expect(yamlBox().readOnly).toBe(false);
    expect(yamlBox().value).toBe(TYPED);
    expect(screen.getByTestId('save-status').textContent).toContain(
      'Unsaved changes',
    );
  });

  it('keeps the raw text to copy when the file changed under the save', async () => {
    const { edits } = drawn();
    edits.save.mockRejectedValue(
      new SaveConflict('The file changed.', 'c'.repeat(64)),
    );
    await settle();
    await typeInto(yamlBox(), TYPED);
    await settle();
    await press('Save');
    await settle();

    expect(screen.getByTestId('conflict')).toBeTruthy();
    expect(yamlBox().readOnly).toBe(false);
    expect(yamlBox().value).toBe(TYPED);
  });

  it('writes the loaded text typed over a renamed stage, leaving the file as it was', async () => {
    const { edits } = drawn();
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await settle();
    expect(yamlBox().value).toContain('name: drafting');

    await typeInto(yamlBox(), HELLO_TEXT);
    await settle();
    await press('Save');
    await settle();

    expect(edits.save).toHaveBeenCalledWith(HELLO_TEXT, HELLO_DOCUMENT.hash);
    await openProperties();
    expect(nameInput().value).toBe('draft');
  });
});

describe('DesignView, a raw edit taken back', () => {
  const TYPED = `${HELLO_TEXT}# typed over\n`;

  const yamlBox = () => screen.getByTestId('yaml-text') as HTMLTextAreaElement;

  const press = async (label: string) => {
    await act(async () => {
      fireEvent.click(button(label));
    });
  };

  it('opens the keys of a stage again, and saves the next form edit', async () => {
    const { edits } = drawn();
    await settle();

    await typeInto(yamlBox(), TYPED);
    await settle();
    expect(screen.getByTestId('stage-keys-frozen')).toBeTruthy();

    await typeInto(yamlBox(), HELLO_TEXT);
    await settle();
    expect(screen.queryByTestId('stage-keys-frozen')).toBeNull();

    await openProperties();
    expect(nameInput().readOnly).toBe(false);
    await typeInto(nameInput(), 'drafting');
    await press('Save');
    await settle();

    expect(edits.save).toHaveBeenCalledWith(
      expect.stringContaining('name: drafting'),
      HELLO_DOCUMENT.hash,
    );
    const [written] = edits.save.mock.calls[0] ?? [];
    expect(written).not.toBe(TYPED);
  });

  it('keeps the keys of a stage shut while a raw save runs, even typed back', async () => {
    const { edits } = drawn();
    let finish = (): void => {};
    edits.save.mockImplementation(
      (text: string) =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              hash: SAVED_HASH,
              view: viewOfText(text),
              diagnostics: [],
            });
        }),
    );
    await settle();
    await typeInto(yamlBox(), TYPED);
    await settle();
    await press('Save');

    await typeInto(yamlBox(), HELLO_TEXT);
    await settle();
    expect(screen.getByTestId('stage-keys-frozen').textContent).toContain(
      'is being saved',
    );
    await openProperties();
    expect(nameInput().readOnly).toBe(true);

    await act(async () => {
      finish();
    });
    await settle();

    expect(edits.save).toHaveBeenCalledWith(TYPED, HELLO_DOCUMENT.hash);
    expect(screen.queryByTestId('stage-keys-frozen')).toBeNull();
    expect(nameInput().readOnly).toBe(false);
  });

  it('comes back to the text of a form edit without a save in between', async () => {
    drawn();
    await settle();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await settle();
    const formText = yamlBox().value;

    await typeInto(yamlBox(), TYPED);
    await settle();
    expect(screen.getByTestId('stage-keys-frozen')).toBeTruthy();

    await typeInto(yamlBox(), formText);
    await settle();

    expect(screen.queryByTestId('stage-keys-frozen')).toBeNull();
    await openProperties();
    expect(nameInput().value).toBe('drafting');
    expect(nameInput().readOnly).toBe(false);
  });
});

// Everything of the sample above its stages, so a replacement text keeps the
// same header and differs only in the stages.
const HEAD_TEXT = HELLO_TEXT.slice(0, HELLO_TEXT.indexOf('stages:\n'));

describe('DesignView, the lines named while the text is typed over', () => {
  const yamlBox = () => screen.getByTestId('yaml-text') as HTMLTextAreaElement;

  const noteOf = () => panelOf('YAML').textContent ?? '';

  // Each of these keeps the stage count, so marking by place would pair the
  // picked stage with another one's lines.
  const SWAPPED = `${HEAD_TEXT}stages:
  - name: review
    agent: k-quality-assurance
  - name: draft
    agent: k-developer
`;
  const RENAMED = `${HEAD_TEXT}stages:
  - name: drafting
    agent: k-developer
  - name: review
    agent: k-quality-assurance
`;
  const REPLACED = `${HEAD_TEXT}stages:
  - name: package
    agent: k-developer
  - name: ship
    agent: k-quality-assurance
`;

  it('names the lines of the picked stage while nothing is typed over', async () => {
    const { scheduler } = drawn();
    await openProperties();
    await typeInto(nameInput(), 'drafting');
    await checkNow(scheduler);

    expect(noteOf()).toContain('are stage drafting');
  });

  it.each([
    ['the stages are swapped', SWAPPED],
    ['the picked stage is renamed', RENAMED],
    ['every stage is replaced', REPLACED],
  ])('names no lines once %s in the text', async (_, text) => {
    const { scheduler } = drawn();
    await settle();

    await typeInto(yamlBox(), text);
    await checkNow(scheduler);

    expect(noteOf()).not.toContain('are stage');
    expect(noteOf()).not.toContain('is stage');
  });

  it('names them again once the text is typed back', async () => {
    const { scheduler } = drawn();
    await settle();
    await typeInto(yamlBox(), SWAPPED);
    await checkNow(scheduler);
    expect(noteOf()).not.toContain('are stage');

    await typeInto(yamlBox(), HELLO_TEXT);
    await checkNow(scheduler);

    expect(noteOf()).toContain('stage draft');
  });
});
