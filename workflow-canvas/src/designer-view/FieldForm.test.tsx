// SPDX-License-Identifier: Apache-2.0
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { FieldForm, type FieldFormChange } from './FieldForm';
import type { FieldValues, StageFieldRule } from './field-rules';

const RULES: StageFieldRule[] = [
  {
    key: 'name',
    type: 'name',
    required: true,
    max_length: 64,
    pattern: '^[a-z0-9][a-z0-9-]{0,63}$',
    reserved: ['start', 'end', 'run', 'halt'],
  },
  {
    key: 'agent',
    type: 'name',
    required: true,
    max_length: 64,
    pattern: '^[a-z0-9][a-z0-9-]{0,63}$',
  },
  {
    key: 'prompt',
    type: 'text',
    required: false,
    min_length: 1,
    max_length: 32768,
    excludes: ['prompt_file'],
  },
  {
    key: 'prompt_file',
    type: 'path',
    required: false,
    excludes: ['prompt'],
  },
];

const AGENTS = [
  { id: 'k-architect', summary: 'System designs' },
  { id: 'k-developer', summary: 'Backend and frontend code' },
];

// A parent that owns the draft, as the Designer will: it keeps each change
// and passes the values back in.
function Owner({
  stageName = 'draft',
  start,
  changes,
}: {
  stageName?: string;
  start: FieldValues;
  changes: FieldFormChange[];
}) {
  const [values, setValues] = useState(start);
  return (
    <FieldForm
      stageName={stageName}
      rules={RULES}
      agents={AGENTS}
      values={values}
      onChange={(change) => {
        changes.push(change);
        setValues(change.values);
      }}
    />
  );
}

function renderForm(
  start: FieldValues = { name: 'draft', agent: 'k-developer' },
) {
  const changes: FieldFormChange[] = [];
  render(<Owner start={start} changes={changes} />);
  return changes;
}

const wrapper = () => createWrapper(document.body);
const field = (label: string) =>
  wrapper()
    .findAllFormFields()
    .find((one) => one.findLabel()?.getElement().textContent === label)!;
const errorOf = (label: string) =>
  field(label).findError()?.getElement().textContent;
const textbox = (label: string) =>
  screen.getByRole('textbox', { name: label }) as HTMLInputElement;
const type = (label: string, value: string) =>
  fireEvent.change(textbox(label), { target: { value } });

function chooseAgent(id: string) {
  const select = field('agent').findControl()!.findSelect()!;
  select.openDropdown();
  const index = select
    .findDropdown()
    .findOptions()
    .findIndex((option) => option.getElement().textContent?.startsWith(id));
  if (index < 0) throw new Error(`The agent ${id} is not offered.`);
  select.selectOption(index + 1);
}

describe('FieldForm', () => {
  it('builds a field for each key, named by the key, with what it takes', () => {
    renderForm();

    expect(screen.getByRole('form', { name: 'Keys of draft' })).toBeTruthy();
    expect(textbox('name').value).toBe('draft');
    expect(textbox('prompt').tagName).toBe('TEXTAREA');
    expect(textbox('prompt_file').tagName).toBe('INPUT');
    expect(field('agent').findControl()?.findSelect()).toBeTruthy();
    expect(field('prompt').findConstraint()?.getElement().textContent).toBe(
      'Optional. At most 32768 characters. Not with prompt_file.',
    );
    expect(errorOf('name')).toBeUndefined();
  });

  it('checks a change at once, and shows the error under its key', () => {
    const changes = renderForm();
    type('name', 'Draft One');

    expect(errorOf('name')).toBe(
      'Use lower-case letters, digits and hyphens, starting with a letter or a digit.',
    );
    expect(textbox('name').getAttribute('aria-invalid')).toBe('true');
    expect(changes.at(-1)).toEqual({
      values: { name: 'Draft One', agent: 'k-developer' },
      errors: {
        name: 'Use lower-case letters, digits and hyphens, starting with a letter or a digit.',
      },
    });
  });

  it('refuses a reserved name', () => {
    renderForm();
    type('name', 'end');

    expect(errorOf('name')).toBe('end is reserved.');
  });

  it('drops a key that is emptied, and asks again for a required one', () => {
    const changes = renderForm();
    type('name', '');

    expect(errorOf('name')).toBe('A stage needs this key.');
    expect(changes.at(-1)?.values).toEqual({ agent: 'k-developer' });
  });

  it('marks both keys of the prompt and prompt_file pair, and clears both when one goes', () => {
    const changes = renderForm({
      name: 'draft',
      agent: 'k-developer',
      prompt: 'Plan it.',
    });
    type('prompt_file', 'prompts/plan.md');

    expect(errorOf('prompt')).toBe('Use prompt or prompt_file, not both.');
    expect(errorOf('prompt_file')).toBe('Use prompt_file or prompt, not both.');

    type('prompt', '');
    expect(errorOf('prompt')).toBeUndefined();
    expect(errorOf('prompt_file')).toBeUndefined();
    expect(changes.at(-1)).toEqual({
      values: {
        name: 'draft',
        agent: 'k-developer',
        prompt_file: 'prompts/plan.md',
      },
      errors: {},
    });
  });

  it('offers the agents of the list, and gives back the one chosen', () => {
    const changes = renderForm();
    chooseAgent('k-architect');

    expect(changes.at(-1)?.values.agent).toBe('k-architect');
  });

  it('keeps on offer an agent the stage names that is not on the list', () => {
    renderForm({ name: 'draft', agent: 'my-agent' });
    const select = field('agent').findControl()!.findSelect()!;
    select.openDropdown();
    const offered = select
      .findDropdown()
      .findOptions()
      .map((option) => option.getElement().textContent);

    expect(offered[0]).toContain('my-agent');
    expect(offered).toHaveLength(3);
  });

  it('passes on a key the rules do not name, as it came', () => {
    const changes = renderForm({
      name: 'draft',
      agent: 'k-developer',
      outputs: 'kept',
    });
    type('name', 'plan');

    expect(changes.at(-1)?.values).toEqual({
      name: 'plan',
      agent: 'k-developer',
      outputs: 'kept',
    });
  });

  it('shows a value with markup in it as text', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <FieldForm
        stageName={hostile}
        rules={RULES}
        agents={AGENTS}
        values={{ name: hostile, agent: 'k-developer' }}
        onChange={() => {}}
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(
      screen.getByRole('form', { name: `Keys of ${hostile}` }),
    ).toBeTruthy();
  });

  it('shows the values it is given, and changes nothing until the parent passes the edit back', () => {
    const changes: FieldFormChange[] = [];
    render(
      <FieldForm
        stageName="draft"
        rules={RULES}
        agents={AGENTS}
        values={{ name: 'draft', agent: 'k-developer' }}
        onChange={(change) => changes.push(change)}
      />,
    );
    type('name', 'plan');

    expect(changes.at(-1)?.values.name).toBe('plan');
    expect(textbox('name').value).toBe('draft');
  });

  it('shows the new stage when the parent switches stages, and edits only its values', () => {
    const STAGE_A = {
      name: 'draft',
      agent: 'k-developer',
      prompt: 'Draft it.',
    };
    const STAGE_B = {
      name: 'review',
      agent: 'k-architect',
      prompt_file: 'review.md',
    };
    const changes: FieldFormChange[] = [];
    const formOf = (stageName: string, values: FieldValues) => (
      <FieldForm
        stageName={stageName}
        rules={RULES}
        agents={AGENTS}
        values={values}
        onChange={(change) => changes.push(change)}
      />
    );
    const { rerender } = render(formOf('draft', STAGE_A));
    rerender(formOf('review', STAGE_B));

    expect(screen.getByRole('form', { name: 'Keys of review' })).toBeTruthy();
    expect(textbox('name').value).toBe('review');
    expect(textbox('prompt').value).toBe('');
    expect(textbox('prompt_file').value).toBe('review.md');

    type('name', 'check');
    expect(changes).toEqual([
      {
        values: {
          name: 'check',
          agent: 'k-architect',
          prompt_file: 'review.md',
        },
        errors: {},
      },
    ]);
  });
});
