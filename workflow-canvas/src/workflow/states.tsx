// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { DiagnosticView } from '../api/types';

/** Shown while the session opens and the workflow loads. */
export function LoadingState() {
  return (
    <div role="status">
      <StatusIndicator type="loading">Loading the workflow</StatusIndicator>
    </div>
  );
}

/** Shown when the workflow could not be loaded. */
export function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert">
      <Alert type="error" header="The workflow did not load">
        {message}
      </Alert>
    </div>
  );
}

/** Shown when there is nothing to draw: no file yet, or a file with errors. */
export function EmptyState({
  hasFile,
  diagnostics,
}: {
  hasFile: boolean;
  diagnostics: readonly DiagnosticView[];
}) {
  return (
    <Box textAlign="center" color="text-status-inactive" padding="l">
      <b>Nothing to draw</b>
      <Box variant="p" color="inherit">
        {hasFile
          ? 'The workflow file has errors, so it cannot be drawn.'
          : 'The workflow has no file yet.'}
      </Box>
      {diagnostics.length > 0 && (
        <ul aria-label="Problems in the workflow file">
          {/* The server may repeat an identical diagnostic, so the position
              is part of the key. The list never reorders. */}
          {diagnostics.map(({ line, message }, index) => (
            <li key={`${index}:${line ?? ''}:${message}`}>
              {line === undefined ? message : `Line ${line}: ${message}`}
            </li>
          ))}
        </ul>
      )}
    </Box>
  );
}
