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
import Textarea from '@cloudscape-design/components/textarea';
import type { ReactNode, Ref } from 'react';
import {
  agentChoices,
  changeBlocker,
  canRemoveStage,
  errorsOf,
  joinMessages,
  MAX_PROMPT_CHARS,
  notesOf,
  problemsFor,
  problemsOfDraft,
  promptFieldOf,
  type DraftStage,
  type EditState,
  type Problem,
  type PromptField,
} from './core';
import { MessageText } from '../workflow/MessageText';

const NAME_HINT =
  'Lower-case letters, digits and hyphens. Each stage has its own name.';
// The text of a field's problems, with the names in it shown as code.
function messageNode(problems: Problem[]): ReactNode {
  const text = joinMessages(problems);
  return text === undefined ? undefined : <MessageText text={text} />;
}

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
        errorText={messageNode(nameErrors)}
        warningText={messageNode(notesOf(nameProblems))}
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
        errorText={messageNode(agentErrors)}
        warningText={messageNode(notesOf(agentProblems))}
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

const TRUST_NOTE = 'Saving a prompt ends trust. The next Run asks again.';
const READS_A_FILE = 'This stage reads its prompt from a file.';
const HAS_BOTH =
  'This stage has both a prompt and a prompt file, so the editor changes neither. The check says what to fix.';

// The characters of the text, as the contract counts them: code points.
const lengthOf = (text: string) => [...text].length;

// Why the text area is off, or `undefined` when the text can be typed.
function offReason(field: PromptField): string | undefined {
  switch (field.kind) {
    case 'file':
      return READS_A_FILE;
    case 'both':
      return HAS_BOTH;
    case 'blocked':
      return field.reason;
    case 'text':
      return undefined;
  }
}

/**
 * The prompt of a stage: a text area with the count of its characters against
 * the limit, or, for a stage that reads a file, the path of the file and a
 * text area that is off, with the reason. The text is shown as typed and never
 * as HTML.
 */
function PromptFields({
  stage,
  field,
  locked,
  problems,
  onPrompt,
}: {
  stage: DraftStage;
  field: PromptField;
  locked: boolean;
  problems: Problem[];
  onPrompt: (prompt: string) => void;
}) {
  const promptProblems = problemsFor(problems, stage.id, 'prompt');
  const fileProblems = problemsFor(problems, stage.id, 'prompt_file');
  const errors = errorsOf([...promptProblems, ...fileProblems]);
  const notes = notesOf([...promptProblems, ...fileProblems]);
  const off = offReason(field);
  const count = lengthOf(stage.prompt);
  return (
    <SpaceBetween size="m">
      <FormField
        label="prompt"
        description={TRUST_NOTE}
        constraintText={
          off === undefined ? (
            `${count} of ${MAX_PROMPT_CHARS} characters`
          ) : (
            <MessageText text={off} />
          )
        }
        errorText={messageNode(errors)}
        warningText={messageNode(notes)}
      >
        <Textarea
          value={stage.prompt}
          rows={6}
          spellcheck={false}
          disabled={off !== undefined}
          readOnly={locked}
          invalid={errors.length > 0 || count > MAX_PROMPT_CHARS}
          onChange={({ detail }) => onPrompt(detail.value)}
        />
      </FormField>
      {(field.kind === 'file' || field.kind === 'both') && (
        <FormField label="prompt_file">
          <Input value={field.path} readOnly spellcheck={false} />
        </FormField>
      )}
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
 * The Properties of the selected stage: its name, its agent and its prompt,
 * all of which change the draft at once, and a button to delete the stage. A problem that
 * the check found with a field shows under the field.
 */
export function PropertiesPane({
  state,
  nameRef,
  onRename,
  onAgent,
  onPrompt,
  onRemove,
}: {
  state: EditState;
  nameRef: Ref<InputProps.Ref>;
  onRename: (id: string, name: string) => void;
  onAgent: (id: string, agent: string) => void;
  onPrompt: (id: string, prompt: string) => void;
  onRemove: (id: string) => void;
}) {
  const stage = state.draft.stages.find((s) => s.id === state.selectedId);
  const problems = problemsOfDraft(state);
  const blocker = changeBlocker(state);
  const editable = blocker === undefined;
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
          <SpaceBetween size="m">
            <Header variant="h3">Prompt</Header>
            <PromptFields
              stage={stage}
              field={promptFieldOf(state, stage)}
              locked={!editable}
              problems={problems}
              onPrompt={(prompt) => onPrompt(stage.id, prompt)}
            />
          </SpaceBetween>
          <Button
            disabled={!editable || !canRemoveStage(state.draft)}
            disabledReason={blocker ?? 'A workflow needs at least one stage.'}
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
