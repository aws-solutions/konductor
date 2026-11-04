// SPDX-License-Identifier: Apache-2.0
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { saveBlocker, saveStatus, type EditState } from './core';

/**
 * The state of the work, as words in a polite live region, and the Save
 * button. A Save that cannot be pressed says why, and keeps keyboard focus.
 */
export function SaveControls({
  state,
  onSave,
}: {
  state: EditState;
  onSave: () => void;
}) {
  const status = saveStatus(state);
  const blocker = saveBlocker(state);
  return (
    <SpaceBetween direction="horizontal" size="s" alignItems="center">
      <div role="status" aria-live="polite" data-testid="save-status">
        <StatusIndicator type={status.kind}>{status.text}</StatusIndicator>
      </div>
      <Button
        variant="primary"
        disabled={blocker !== undefined}
        disabledReason={blocker}
        loading={state.save.phase === 'saving'}
        onClick={onSave}
      >
        Save
      </Button>
    </SpaceBetween>
  );
}
