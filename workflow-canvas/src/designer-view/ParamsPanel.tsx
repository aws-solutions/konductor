// SPDX-License-Identifier: Apache-2.0
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { DraftParam } from '../designer/core/draft';

/** Changes to one declared workflow parameter. */
export type ParamChange = Partial<
  Pick<DraftParam, 'name' | 'description' | 'default' | 'required'>
>;

export const PARAM_NAME_ERROR =
  'A parameter name must start with a lowercase letter and contain only lowercase letters, digits or underscores, up to 64 characters.';
const PARAM_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** The writer error for a parameter name, if it has one. */
export function parameterNameError(name: string): string | undefined {
  return PARAM_NAME.test(name) ? undefined : PARAM_NAME_ERROR;
}

/** The editable workflow parameter declarations shown in the side panel. */
export function ParamsPanel({
  params,
  disabled,
  disabledReason,
  onChange,
  onAdd,
  onRemove,
}: {
  params: readonly DraftParam[];
  disabled: boolean;
  disabledReason?: string;
  onChange: (id: string, change: ParamChange) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <SpaceBetween size="m">
      <Box variant="awsui-key-label">Parameters</Box>
      {params.map((param) => {
        const nameError = parameterNameError(param.name);
        return (
          <Container key={param.id}>
            <SpaceBetween size="s">
              <FormField label="name" errorText={nameError}>
                <Input
                  value={param.name}
                  invalid={nameError !== undefined}
                  disabled={disabled || param.isGoal}
                  onChange={({ detail }) =>
                    onChange(param.id, { name: detail.value })
                  }
                />
              </FormField>
              <FormField label="description">
                <Input
                  value={param.description}
                  disabled={disabled}
                  onChange={({ detail }) =>
                    onChange(param.id, { description: detail.value })
                  }
                />
              </FormField>
              <FormField label="default">
                <Input
                  value={param.default}
                  disabled={disabled}
                  onChange={({ detail }) =>
                    onChange(param.id, { default: detail.value })
                  }
                />
              </FormField>
              <Checkbox
                checked={param.required}
                disabled={disabled || param.isGoal}
                onChange={({ detail }) =>
                  onChange(param.id, { required: detail.checked })
                }
              >
                required
              </Checkbox>
              <Button
                disabled={disabled || param.isGoal}
                disabledReason={
                  param.isGoal
                    ? 'The goal parameter is always present.'
                    : disabledReason
                }
                onClick={() => onRemove(param.id)}
              >
                Remove parameter
              </Button>
            </SpaceBetween>
          </Container>
        );
      })}
      <Button
        iconName="add-plus"
        disabled={disabled}
        disabledReason={disabledReason}
        onClick={onAdd}
      >
        Add parameter
      </Button>
    </SpaceBetween>
  );
}
