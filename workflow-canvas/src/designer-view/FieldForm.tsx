// SPDX-License-Identifier: Apache-2.0
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import {
  agentOptions,
  fieldErrors,
  fieldHint,
  textOf,
  withValue,
  type AgentOption,
  type FieldValues,
  type StageFieldRule,
} from './field-rules';

/** The edited keys of a stage, and what is wrong with them. */
export interface FieldFormChange {
  readonly values: FieldValues;
  /** The error of each key that has one; empty when every key is fine. */
  readonly errors: Readonly<Record<string, string>>;
}

const AGENT_KEY = 'agent';

function Control({
  rule,
  value,
  invalid,
  agents,
  onText,
}: {
  rule: StageFieldRule;
  value: string | undefined;
  invalid: boolean;
  agents: readonly AgentOption[];
  onText: (text: string) => void;
}) {
  if (rule.key === AGENT_KEY) {
    const choices = agentOptions(agents, value);
    const chosen = choices.find((agent) => agent.id === value);
    return (
      <Select
        selectedOption={
          chosen
            ? {
                value: chosen.id,
                label: chosen.id,
                description: chosen.summary,
              }
            : null
        }
        placeholder="Choose an agent"
        options={choices.map(({ id, summary }) => ({
          value: id,
          label: id,
          description: summary,
        }))}
        invalid={invalid}
        onChange={({ detail }) => onText(detail.selectedOption.value ?? '')}
      />
    );
  }
  if (rule.type === 'text') {
    return (
      <Textarea
        value={value ?? ''}
        invalid={invalid}
        spellcheck
        onChange={({ detail }) => onText(detail.value)}
      />
    );
  }
  return (
    <Input
      value={value ?? ''}
      invalid={invalid}
      spellcheck={false}
      autoComplete={false}
      onChange={({ detail }) => onText(detail.value)}
    />
  );
}

/**
 * The form of one stage, built from its `stage_fields`. It is controlled:
 * it shows `values` and keeps no copy, so a parent that switches stages
 * shows the new stage at once. Each change is checked against the rules of
 * the keys, each error is shown under its key, and `onChange` gets the
 * edited values, made from the current `values`. It never writes YAML: a key
 * the rules do not name is passed on as it came.
 */
export function FieldForm({
  stageName,
  rules,
  agents,
  values,
  onChange,
}: {
  /** Names the form for a screen reader. */
  stageName: string;
  rules: readonly StageFieldRule[];
  /** The agents of `GET /api/agents`, offered for the `agent` key. */
  agents: readonly AgentOption[];
  /** The keys of the stage now, which the parent owns. */
  values: FieldValues;
  onChange: (change: FieldFormChange) => void;
}) {
  const errors = fieldErrors(rules, values);
  const edit = (key: string, text: string) => {
    const next = withValue(values, key, text);
    onChange({ values: next, errors: fieldErrors(rules, next) });
  };
  return (
    <form
      aria-label={`Keys of ${stageName}`}
      onSubmit={(event) => event.preventDefault()}
    >
      <SpaceBetween size="m">
        {rules.map((rule) => {
          const error = textOf(errors, rule.key);
          return (
            <FormField
              key={rule.key}
              label={rule.key}
              constraintText={fieldHint(rule)}
              errorText={error}
            >
              <Control
                rule={rule}
                value={textOf(values, rule.key)}
                invalid={error !== undefined}
                agents={agents}
                onText={(text) => edit(rule.key, text)}
              />
            </FormField>
          );
        })}
      </SpaceBetween>
    </form>
  );
}
