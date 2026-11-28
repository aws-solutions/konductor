// SPDX-License-Identifier: Apache-2.0
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { DraftOutput } from '../designer/core/draft';
import { outputNameError } from '../designer/core/outputs-text';

/** A change to one output declaration. */
export interface OutputChange {
  readonly name: string;
  readonly path: string;
}

/** Edits the output names and paths declared by one stage. */
export function OutputsPanel({
  outputs,
  disabled = false,
  disabledReason,
  onChange,
  onAdd,
  onRemove,
}: {
  outputs: readonly DraftOutput[];
  disabled?: boolean;
  disabledReason?: string;
  onChange: (id: string, change: OutputChange) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const duplicate = (name: string, id: string) =>
    name !== '' &&
    outputs.some((output) => output.id !== id && output.name === name)
      ? 'Output names must be unique in a stage.'
      : undefined;
  return (
    <SpaceBetween size="m">
      {outputs.map((output, index) => {
        const nameError =
          outputNameError(output.name) ?? duplicate(output.name, output.id);
        return (
          <SpaceBetween key={output.id} size="s">
            <FormField label="name" errorText={nameError}>
              <Input
                value={output.name}
                invalid={nameError !== undefined}
                disabled={disabled}
                ariaLabel={`Output name ${index + 1}`}
                onChange={({ detail }) =>
                  onChange(output.id, { name: detail.value, path: output.path })
                }
              />
            </FormField>
            <FormField label="path">
              <Input
                value={output.path}
                disabled={disabled}
                ariaLabel={`Output path ${index + 1}`}
                onChange={({ detail }) =>
                  onChange(output.id, { name: output.name, path: detail.value })
                }
              />
            </FormField>
            <Button
              disabled={disabled}
              disabledReason={disabledReason}
              onClick={() => onRemove(output.id)}
            >
              Remove output
            </Button>
          </SpaceBetween>
        );
      })}
      <Button
        iconName="add-plus"
        disabled={disabled}
        disabledReason={disabledReason}
        onClick={onAdd}
      >
        Add output
      </Button>
    </SpaceBetween>
  );
}
