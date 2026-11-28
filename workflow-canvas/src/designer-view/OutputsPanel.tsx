// SPDX-License-Identifier: Apache-2.0
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useLayoutEffect, useRef } from 'react';
import type { DraftOutput } from '../designer/core/draft';
import { outputNameError } from '../designer/core/outputs-text';

/** A change to one output declaration. */
export interface OutputChange {
  readonly name: string;
  readonly path: string;
}

/** The field errors of one output row. */
export interface OutputRowErrors {
  readonly name?: string;
  readonly path?: string;
}

const DUPLICATE_ERROR = 'Output names must be unique in a stage.';
const PATH_ERROR =
  'Use a relative path inside the project, with / between its parts.';

export function pathValueError(path: string): string | undefined {
  if (
    path === '' ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.includes('\\') ||
    /[\u0000-\u001F\u007F-\u009F]/.test(path) ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    return PATH_ERROR;
  }
  return undefined;
}

/** Field errors for every output row, keyed by stable row id. */
export function outputRowErrors(
  outputs: readonly DraftOutput[],
): Readonly<Record<string, OutputRowErrors>> {
  const counts = new Map<string, number>();
  for (const { name } of outputs) counts.set(name, (counts.get(name) ?? 0) + 1);
  return Object.fromEntries(
    outputs.map((output) => [
      output.id,
      {
        ...(outputNameError(output.name)
          ? { name: outputNameError(output.name) }
          : (counts.get(output.name) ?? 0) > 1
            ? { name: DUPLICATE_ERROR }
            : {}),
        ...(pathValueError(output.path)
          ? { path: pathValueError(output.path) }
          : {}),
      },
    ]),
  );
}

/** Edits the output names and paths declared by one stage. */
export function OutputsPanel({
  outputs,
  disabled = false,
  disabledReason,
  structuralDisabled = disabled,
  structuralDisabledReason = disabledReason,
  onChange,
  onAdd,
  onRemove,
}: {
  outputs: readonly DraftOutput[];
  disabled?: boolean;
  disabledReason?: string;
  structuralDisabled?: boolean;
  structuralDisabledReason?: string;
  onChange: (id: string, change: OutputChange) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const errors = outputRowErrors(outputs);
  const names = useRef(new Map<string, InputProps.Ref>());
  const add = useRef<ButtonProps.Ref>(null);
  const focus = useRef<
    | { readonly kind: 'add'; readonly before: ReadonlySet<string> }
    | { readonly kind: 'row'; readonly id?: string }
    | undefined
  >(undefined);
  useLayoutEffect(() => {
    const pending = focus.current;
    if (!pending) return;
    focus.current = undefined;
    if (pending.kind === 'add') {
      const added = outputs.find(({ id }) => !pending.before.has(id));
      if (added) names.current.get(added.id)?.focus();
      return;
    }
    if (pending.id) names.current.get(pending.id)?.focus();
    else add.current?.focus();
  }, [outputs]);
  const remove = (index: number) => {
    focus.current = {
      kind: 'row',
      id: outputs[index + 1]?.id ?? outputs[index - 1]?.id,
    };
    onRemove(outputs[index]!.id);
  };
  return (
    <SpaceBetween size="m">
      <Box className="wf-panel-section-label" variant="awsui-key-label">
        Outputs
      </Box>
      {outputs.map((output, index) => {
        const error = errors[output.id] ?? {};
        return (
          <SpaceBetween key={output.id} size="s">
            <FormField label="name" errorText={error.name}>
              <Input
                ref={(control) => {
                  if (control) names.current.set(output.id, control);
                  else names.current.delete(output.id);
                }}
                value={output.name}
                invalid={error.name !== undefined}
                disabled={disabled}
                ariaLabel={`Output name ${index + 1}`}
                onChange={({ detail }) =>
                  onChange(output.id, { name: detail.value, path: output.path })
                }
              />
            </FormField>
            <FormField label="path" errorText={error.path}>
              <Input
                value={output.path}
                invalid={error.path !== undefined}
                disabled={disabled}
                ariaLabel={`Output path ${index + 1}`}
                onChange={({ detail }) =>
                  onChange(output.id, { name: output.name, path: detail.value })
                }
              />
            </FormField>
            <Button
              disabled={structuralDisabled}
              disabledReason={structuralDisabledReason}
              onClick={() => remove(index)}
            >
              Remove output
            </Button>
          </SpaceBetween>
        );
      })}
      <Button
        ref={add}
        iconName="add-plus"
        disabled={structuralDisabled}
        disabledReason={structuralDisabledReason}
        onClick={() => {
          focus.current = {
            kind: 'add',
            before: new Set(outputs.map(({ id }) => id)),
          };
          onAdd();
        }}
      >
        Add output
      </Button>
    </SpaceBetween>
  );
}
