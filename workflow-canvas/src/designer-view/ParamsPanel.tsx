// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
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
      {disabledReason && (
        <Alert type="warning" data-testid="params-blocker">
          {disabledReason}
        </Alert>
      )}
      {params.map((param) => (
        <Container key={param.id}>
          <SpaceBetween size="s">
            <FormField label="name">
              <Input
                value={param.name}
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
      ))}
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
