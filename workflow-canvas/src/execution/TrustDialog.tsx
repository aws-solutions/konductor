// SPDX-License-Identifier: Apache-2.0
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';
import { plainText } from '../workflow/message-parts';
import { MessageText } from '../workflow/MessageText';
import { trustCommandOf, type ExecutionState, type TrustRefusal } from './core';

function TrustModal({
  trust,
  workflowName,
  onRunAgain,
}: {
  trust: TrustRefusal;
  workflowName: string | undefined;
  onRunAgain: (goal: string) => void;
}) {
  // The refusal that was closed. It is a number of the state, not the state
  // object, so a state rebuilt with the same content stays closed, and the
  // next refusal, which has the next number, opens the dialog.
  const [closed, setClosed] = useState<number>();
  const close = () => setClosed(trust.refusal);
  const command = trustCommandOf(trust.fix, workflowName);
  return (
    <Modal
      visible={closed !== trust.refusal}
      onDismiss={close}
      closeAriaLabel="Close the dialog"
      header="Trust the workflow to run it"
      data-testid="trust-dialog"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={close}>
              Close
            </Button>
            <Button variant="primary" onClick={() => onRunAgain(trust.goal)}>
              Run again
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box data-testid="trust-intro">
          {command !== undefined
            ? 'The workflow is not trusted, so it did not run. Run the command in a terminal and answer its question, then press Run again. This page cannot trust a workflow.'
            : 'The workflow is not trusted, so it did not run. Trust it as the message below says, then press Run again. This page cannot trust a workflow.'}
        </Box>
        {/* A fix with no command to offer shows as plain text, so nothing in
            it looks like a command that is ready to paste. */}
        <Box data-testid="trust-fix">
          {command !== undefined ? (
            <MessageText text={trust.fix} />
          ) : (
            plainText(trust.fix)
          )}
        </Box>
        {command !== undefined && (
          <SpaceBetween direction="horizontal" size="xs" alignItems="center">
            <Box variant="code" data-testid="trust-command">
              {command}
            </Box>
            <CopyToClipboard
              variant="button"
              copyButtonText="Copy"
              copyButtonAriaLabel="Copy command"
              textToCopy={command}
              copySuccessText="Command copied"
              copyErrorText="The command could not be copied. Select it and copy it yourself."
            />
          </SpaceBetween>
        )}
      </SpaceBetween>
    </Modal>
  );
}

/**
 * Opens when a Run is refused because the workflow is not trusted. It shows
 * the `fix` of the server and its command, with a button that copies the
 * command and one that asks for the same run again. The command and Copy show
 * only when the command is `konductor flow trust` and `workflowName`, the name
 * of the workflow on the page, since the text comes from the server and is
 * meant for a terminal; otherwise the dialog shows the `fix` alone. The page never grants trust: the person runs
 * the command in a terminal. Closing the dialog leaves the error under the
 * Run button; a refusal that comes again opens it again.
 */
export function TrustDialog({
  state,
  workflowName,
  onRunAgain,
}: {
  state: ExecutionState;
  workflowName: string | undefined;
  onRunAgain: (goal: string) => void;
}) {
  const trust = state.phase === 'error' ? state.trust : undefined;
  if (!trust) return null;
  return (
    <TrustModal
      trust={trust}
      workflowName={workflowName}
      onRunAgain={onRunAgain}
    />
  );
}
