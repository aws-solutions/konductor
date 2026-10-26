// SPDX-License-Identifier: Apache-2.0
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { Ref } from 'react';
import {
  agentChoices,
  canRemoveStage,
  problemsFor,
  problemsOfDraft,
  type DraftStage,
  type EditState,
  type Problem,
} from './core';

const NAME_HINT =
  'Lower-case letters, digits and hyphens. Each stage has its own name.';
const AGENT_NOTE = 'A Konductor agent id: the name of an agent spec.';

function StageFields({
  stage,
  problems,
  nameRef,
  onRename,
  onAgent,
}: {
  stage: DraftStage;
  problems: Problem[];
  nameRef: Ref<InputProps.Ref>;
  onRename: (name: string) => void;
  onAgent: (agent: string) => void;
}) {
  const choices = agentChoices(stage.agent);
  const chosen = choices.find((agent) => agent.id === stage.agent);
  const nameProblems = problemsFor(problems, stage.id, 'name');
  const agentProblems = problemsFor(problems, stage.id, 'agent');
  return (
    <SpaceBetween size="m">
      <FormField
        label="name"
        constraintText={NAME_HINT}
        errorText={nameProblems.join(' ') || undefined}
      >
        <Input
          ref={nameRef}
          value={stage.name}
          invalid={nameProblems.length > 0}
          onChange={({ detail }) => onRename(detail.value)}
        />
      </FormField>
      <FormField
        label="agent"
        description={`${AGENT_NOTE} ${chosen?.summary ?? ''}`.trim()}
        errorText={agentProblems.join(' ') || undefined}
      >
        <Select
          selectedOption={{
            value: stage.agent,
            label: stage.agent,
            description: chosen?.summary,
          }}
          options={choices.map(({ id, summary }) => ({
            value: id,
            label: id,
            description: summary,
          }))}
          invalid={agentProblems.length > 0}
          onChange={({ detail }) =>
            onAgent(detail.selectedOption.value ?? stage.agent)
          }
        />
      </FormField>
    </SpaceBetween>
  );
}

/**
 * The Properties of the selected stage: its name and its agent, both of which
 * change the draft at once, and a button to delete the stage. A problem that
 * the check found with a field shows under the field.
 */
export function PropertiesPane({
  state,
  nameRef,
  onRename,
  onAgent,
  onRemove,
}: {
  state: EditState;
  nameRef: Ref<InputProps.Ref>;
  onRename: (id: string, name: string) => void;
  onAgent: (id: string, agent: string) => void;
  onRemove: (id: string) => void;
}) {
  const stage = state.draft.stages.find((s) => s.id === state.selectedId);
  const problems = problemsOfDraft(state);
  const fixable = stage ? problems.some((p) => p.stageId === stage.id) : false;
  return (
    <Container header={<Header variant="h2">Properties</Header>}>
      {stage ? (
        <SpaceBetween size="l">
          <Box color="text-body-secondary" fontSize="body-s">
            Selected: <b>{stage.name || 'a stage with no name'}</b>
          </Box>
          <SpaceBetween size="m">
            <Header
              variant="h3"
              actions={
                <StatusIndicator type={fixable ? 'error' : 'success'}>
                  {fixable ? 'Needs a fix' : 'Complete'}
                </StatusIndicator>
              }
            >
              Required
            </Header>
            <StageFields
              stage={stage}
              problems={problems}
              nameRef={nameRef}
              onRename={(name) => onRename(stage.id, name)}
              onAgent={(agent) => onAgent(stage.id, agent)}
            />
          </SpaceBetween>
          <Button
            disabled={!canRemoveStage(state.draft)}
            disabledReason="A workflow needs at least one stage."
            onClick={() => onRemove(stage.id)}
          >
            Delete stage
          </Button>
        </SpaceBetween>
      ) : (
        <Box color="text-status-inactive">Select a stage to edit it.</Box>
      )}
    </Container>
  );
}
