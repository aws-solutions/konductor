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
  canEdit,
  canRemoveStage,
  errorsOf,
  joinMessages,
  notesOf,
  problemsFor,
  READ_ONLY_REASON,
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
  locked,
  extraAgents,
  problems,
  nameRef,
  onRename,
  onAgent,
}: {
  stage: DraftStage;
  /** True when the workflow is read-only, so nothing here changes it. */
  locked: boolean;
  /** Agents the saved file names, which stay on offer once another is chosen. */
  extraAgents: readonly string[];
  problems: Problem[];
  nameRef: Ref<InputProps.Ref>;
  onRename: (name: string) => void;
  onAgent: (agent: string) => void;
}) {
  const choices = agentChoices(stage.agent, extraAgents);
  const chosen = choices.find((agent) => agent.id === stage.agent);
  const nameProblems = problemsFor(problems, stage.id, 'name');
  const agentProblems = problemsFor(problems, stage.id, 'agent');
  const nameErrors = errorsOf(nameProblems);
  const agentErrors = errorsOf(agentProblems);
  return (
    <SpaceBetween size="m">
      <FormField
        label="name"
        constraintText={NAME_HINT}
        errorText={joinMessages(nameErrors)}
        warningText={joinMessages(notesOf(nameProblems))}
      >
        <Input
          ref={nameRef}
          value={stage.name}
          spellcheck={false}
          autoComplete={false}
          readOnly={locked}
          invalid={nameErrors.length > 0}
          onChange={({ detail }) => onRename(detail.value)}
        />
      </FormField>
      <FormField
        label="agent"
        description={
          <>
            {AGENT_NOTE}
            {chosen && <div>{chosen.summary}</div>}
          </>
        }
        errorText={joinMessages(agentErrors)}
        warningText={joinMessages(notesOf(agentProblems))}
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
          disabled={locked}
          invalid={agentErrors.length > 0}
          onChange={({ detail }) =>
            onAgent(detail.selectedOption.value ?? stage.agent)
          }
        />
      </FormField>
    </SpaceBetween>
  );
}

// Whether the stage is complete, needs a fix (an error) or has a note.
function StageStatus({ problems }: { problems: Problem[] }) {
  if (errorsOf(problems).length > 0) {
    return <StatusIndicator type="error">Needs a fix</StatusIndicator>;
  }
  if (problems.length > 0) {
    return <StatusIndicator type="warning">Has a note</StatusIndicator>;
  }
  return <StatusIndicator type="success">Complete</StatusIndicator>;
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
  const editable = canEdit(state);
  const own = problems.filter((p) => p.stageId === stage?.id);
  // No verdict until a check has answered for the draft as it is now.
  const checked = state.check.revision === state.revision;
  return (
    <Container header={<Header variant="h2">Properties</Header>}>
      {stage ? (
        <SpaceBetween size="l">
          <Box color="text-body-secondary" fontSize="body-s">
            Selected:{' '}
            <Box variant="strong">{stage.name || 'a stage with no name'}</Box>
          </Box>
          <SpaceBetween size="m">
            <Header
              variant="h3"
              actions={checked ? <StageStatus problems={own} /> : undefined}
            >
              Required
            </Header>
            <StageFields
              stage={stage}
              locked={!editable}
              extraAgents={state.saved.view.stages.map((s) => s.agent)}
              problems={problems}
              nameRef={nameRef}
              onRename={(name) => onRename(stage.id, name)}
              onAgent={(agent) => onAgent(stage.id, agent)}
            />
          </SpaceBetween>
          <Button
            disabled={!editable || !canRemoveStage(state.draft)}
            disabledReason={
              editable
                ? 'A workflow needs at least one stage.'
                : READ_ONLY_REASON
            }
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
