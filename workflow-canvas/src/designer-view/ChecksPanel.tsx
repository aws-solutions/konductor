// SPDX-License-Identifier: Apache-2.0
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import type { DraftCheck } from '../designer/core/draft';
import { checkIdError } from '../designer/core/checks-spots';

/** Edits the file and run checks declared by the workflow intent. */
export function ChecksPanel({
  checks,
  onChange,
  onAdd,
  onRemove,
}: {
  checks: readonly DraftCheck[];
  onChange: (key: string, check: Omit<DraftCheck, 'key'>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  const change = (
    check: DraftCheck,
    values: Partial<Omit<DraftCheck, 'key'>>,
  ) => onChange(check.key, { ...check, ...values });
  return (
    <SpaceBetween size="m">
      {checks.map((check, index) => {
        const error =
          checkIdError(check.id) ??
          (checks.some(
            (other) => other.key !== check.key && other.id === check.id,
          )
            ? 'Check ids must be unique.'
            : undefined);
        return (
          <SpaceBetween key={check.key} size="s">
            <FormField label="id" errorText={error}>
              <Input
                value={check.id}
                invalid={error !== undefined}
                ariaLabel={`Check id ${index + 1}`}
                onChange={({ detail }) => change(check, { id: detail.value })}
              />
            </FormField>
            <FormField label="kind">
              <Select
                selectedOption={{ value: check.kind, label: check.kind }}
                options={[
                  { value: 'file', label: 'file' },
                  { value: 'run', label: 'run' },
                ]}
                ariaLabel={`Check kind ${index + 1}`}
                onChange={({ detail }) =>
                  change(check, {
                    kind:
                      detail.selectedOption.value === 'run' ? 'run' : 'file',
                  })
                }
              />
            </FormField>
            {check.kind === 'file' ? (
              <FormField label="file">
                <Input
                  value={check.file}
                  ariaLabel={`Check file ${index + 1}`}
                  onChange={({ detail }) =>
                    change(check, { file: detail.value })
                  }
                />
              </FormField>
            ) : (
              <FormField
                label="run"
                constraintText="One argument per line. The first line is the program."
              >
                <Textarea
                  value={check.run.join('\n')}
                  ariaLabel={`Check run ${index + 1}`}
                  onChange={({ detail }) =>
                    change(check, { run: detail.value.split(/\r?\n/) })
                  }
                />
              </FormField>
            )}
            <Button onClick={() => onRemove(check.key)}>Remove check</Button>
          </SpaceBetween>
        );
      })}
      <Button iconName="add-plus" onClick={onAdd}>
        Add check
      </Button>
    </SpaceBetween>
  );
}
