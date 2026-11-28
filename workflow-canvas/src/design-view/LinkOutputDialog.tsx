// SPDX-License-Identifier: Apache-2.0
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect } from 'react';
import type { DraftOutput } from '../designer/core/draft';
import { pathValueError } from '../designer/core/link-validation';
import { outputNameError } from '../designer/core/outputs-text';

/** The values collected before a data link changes the draft. */
export interface LinkDialogValues {
  readonly outputName: string;
  readonly outputPath: string;
}

const optionOf = ({ name, path }: DraftOutput) => ({
  value: name,
  label: name,
  description: path,
});

/** Chooses an existing output or declares the first output of a stage. */
export function LinkOutputDialog({
  sourceName,
  targetName,
  outputs,
  values,
  onChange,
  onCancel,
  onConfirm,
  onError,
}: {
  sourceName: string;
  targetName: string;
  outputs: readonly DraftOutput[];
  values: LinkDialogValues;
  onChange: (values: LinkDialogValues) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onError: (message: string | undefined) => void;
}) {
  const creates = outputs.length === 0;
  const nameError = creates ? outputNameError(values.outputName) : undefined;
  const pathError = creates ? pathValueError(values.outputPath) : undefined;
  const error = nameError ?? pathError;
  useEffect(() => onError(error), [error, onError]);
  const chosen = outputs.find(({ name }) => name === values.outputName);
  const set = (change: Partial<LinkDialogValues>) =>
    onChange({ ...values, ...change });
  return (
    <Modal
      visible
      onDismiss={onCancel}
      closeAriaLabel="Close the link output dialog"
      header={`Link ${sourceName} to ${targetName}`}
      data-testid="link-output-dialog"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={creates ? !!nameError || !!pathError : !chosen}
              onClick={onConfirm}
            >
              Link output
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      {creates ? (
        <SpaceBetween size="m">
          <FormField label="Output name" errorText={nameError}>
            <Input
              value={values.outputName}
              invalid={!!nameError}
              autoComplete={false}
              onChange={({ detail }) => set({ outputName: detail.value })}
            />
          </FormField>
          <FormField label="Output path" errorText={pathError}>
            <Input
              value={values.outputPath}
              invalid={!!pathError}
              autoComplete={false}
              onChange={({ detail }) => set({ outputPath: detail.value })}
            />
          </FormField>
        </SpaceBetween>
      ) : (
        <FormField label="Output">
          <Select
            selectedOption={chosen ? optionOf(chosen) : null}
            placeholder="Choose an output"
            options={outputs.map(optionOf)}
            onChange={({ detail }) =>
              set({ outputName: detail.selectedOption.value ?? '' })
            }
          />
        </FormField>
      )}
    </Modal>
  );
}
