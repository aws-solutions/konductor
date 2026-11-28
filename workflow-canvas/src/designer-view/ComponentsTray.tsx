// SPDX-License-Identifier: Apache-2.0
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useMemo, useState, type DragEvent } from 'react';
import { AGENT_DRAG_TYPE } from '../canvas/agent-drag';
import { agentColor, agentInitials } from '../canvas/agent-badge';
import type { AgentOption } from './field-rules';
import './components-tray.css';

/** Agents that can be filtered, dragged onto the canvas, or added with Enter. */
export function ComponentsTray({
  agents,
  disabled,
  disabledReason,
  onAdd,
}: {
  agents: readonly AgentOption[];
  disabled: boolean;
  disabledReason: string;
  onAdd: (agent: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    return query === ''
      ? agents
      : agents.filter(({ id, summary }) =>
          `${id} ${summary}`.toLocaleLowerCase().includes(query),
        );
  }, [agents, filter]);
  const drag = (event: DragEvent<HTMLButtonElement>, id: string) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(AGENT_DRAG_TYPE, id);
  };

  return (
    <SpaceBetween size="s">
      <Box variant="awsui-key-label">Components</Box>
      <FormField label="Filter components">
        <Input
          type="search"
          clearAriaLabel="Clear component filter"
          value={filter}
          onChange={({ detail }) => setFilter(detail.value)}
        />
      </FormField>
      <SpaceBetween size="xs">
        {shown.map(({ id, summary }) => (
          <Button
            key={id}
            fullWidth
            disabled={disabled}
            disabledReason={disabledReason}
            onClick={() => onAdd(id)}
            nativeButtonAttributes={{
              draggable: !disabled,
              onDragStart: (event) => drag(event, id),
              className: `wf-component-row wf-agent-color-${agentColor(id)}`,
              'data-agent-initials': agentInitials(id),
            }}
          >
            <Box className="wf-component-copy">
              <Box fontWeight="bold">{id}</Box>
              <Box color="text-body-secondary" fontSize="body-s">
                {summary}
              </Box>
            </Box>
          </Button>
        ))}
      </SpaceBetween>
      {shown.length === 0 && (
        <Box color="text-body-secondary">No agents match the filter.</Box>
      )}
      {disabled && (
        <Box data-testid="component-limit-reason" color="text-body-secondary">
          {disabledReason}
        </Box>
      )}
    </SpaceBetween>
  );
}
