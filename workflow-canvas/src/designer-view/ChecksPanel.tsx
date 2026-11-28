// SPDX-License-Identifier: Apache-2.0
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useLayoutEffect, useRef } from 'react';
import type { DraftCheck } from '../designer/core/draft';
import { CHECK_RUN_ERROR, checkIdError } from '../designer/core/checks-spots';
import { pathValueError } from './OutputsPanel';

/** Field errors for one acceptance-check row. */
export interface CheckRowErrors {
  readonly id?: string;
  readonly file?: string;
  readonly run?: string;
}

/** Field errors for every check row, keyed by stable row key. */
export function checkRowErrors(
  checks: readonly DraftCheck[],
): Readonly<Record<string, CheckRowErrors>> {
  const counts = new Map<string, number>();
  for (const { id } of checks) counts.set(id, (counts.get(id) ?? 0) + 1);
  return Object.fromEntries(
    checks.map((check) => [
      check.key,
      {
        ...(checkIdError(check.id)
          ? { id: checkIdError(check.id) }
          : (counts.get(check.id) ?? 0) > 1
            ? { id: 'Check ids must be unique.' }
            : {}),
        ...(check.kind === 'file' && pathValueError(check.file)
          ? { file: pathValueError(check.file) }
          : {}),
        ...(check.kind === 'run' && check.run.length === 0
          ? { run: CHECK_RUN_ERROR }
          : {}),
      },
    ]),
  );
}

/** Edits the file and run checks declared by the workflow intent. */
export function ChecksPanel({
  checks,
  disabled = false,
  disabledReason,
  structuralDisabled = disabled,
  structuralDisabledReason = disabledReason,
  onChange,
  onAdd,
  onRemove,
}: {
  checks: readonly DraftCheck[];
  disabled?: boolean;
  disabledReason?: string;
  structuralDisabled?: boolean;
  structuralDisabledReason?: string;
  onChange: (
    key: string,
    check: Omit<DraftCheck, 'key' | 'sourceIndex'>,
  ) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  const errors = checkRowErrors(checks);
  const ids = useRef(new Map<string, InputProps.Ref>());
  const add = useRef<ButtonProps.Ref>(null);
  const focus = useRef<
    | { readonly kind: 'add'; readonly before: ReadonlySet<string> }
    | { readonly kind: 'row'; readonly key?: string }
    | undefined
  >(undefined);
  useLayoutEffect(() => {
    const pending = focus.current;
    if (!pending) return;
    focus.current = undefined;
    if (pending.kind === 'add') {
      const added = checks.find(({ key }) => !pending.before.has(key));
      if (added) ids.current.get(added.key)?.focus();
      return;
    }
    if (pending.key) ids.current.get(pending.key)?.focus();
    else add.current?.focus();
  }, [checks]);
  const change = (
    check: DraftCheck,
    values: Partial<Omit<DraftCheck, 'key' | 'sourceIndex'>>,
  ) => {
    const { id, kind, file, run } = check;
    onChange(check.key, { id, kind, file, run, ...values });
  };
  const remove = (index: number) => {
    focus.current = {
      kind: 'row',
      key: checks[index + 1]?.key ?? checks[index - 1]?.key,
    };
    onRemove(checks[index]!.key);
  };
  return (
    <SpaceBetween size="m">
      {checks.map((check, index) => {
        const error = errors[check.key] ?? {};
        return (
          <SpaceBetween key={check.key} size="s">
            <FormField label="id" errorText={error.id}>
              <Input
                ref={(control) => {
                  if (control) ids.current.set(check.key, control);
                  else ids.current.delete(check.key);
                }}
                value={check.id}
                invalid={error.id !== undefined}
                disabled={disabled}
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
                disabled={disabled}
                onChange={({ detail }) =>
                  change(check, {
                    kind:
                      detail.selectedOption.value === 'run' ? 'run' : 'file',
                  })
                }
              />
            </FormField>
            {check.kind === 'file' ? (
              <FormField label="file" errorText={error.file}>
                <Input
                  value={check.file}
                  invalid={error.file !== undefined}
                  disabled={disabled}
                  ariaLabel={`Check file ${index + 1}`}
                  onChange={({ detail }) =>
                    change(check, { file: detail.value })
                  }
                />
              </FormField>
            ) : (
              <FormField
                label="run"
                errorText={error.run}
                constraintText="One argument per line. The first line is the program."
              >
                <Textarea
                  value={check.run.join('\n')}
                  invalid={error.run !== undefined}
                  disabled={disabled}
                  ariaLabel={`Check run ${index + 1}`}
                  onChange={({ detail }) =>
                    change(check, {
                      run:
                        detail.value === '' ? [] : detail.value.split(/\r?\n/),
                    })
                  }
                />
              </FormField>
            )}
            <Button
              disabled={structuralDisabled}
              disabledReason={structuralDisabledReason}
              onClick={() => remove(index)}
            >
              Remove check
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
            before: new Set(checks.map(({ key }) => key)),
          };
          onAdd();
        }}
      >
        Add check
      </Button>
    </SpaceBetween>
  );
}
