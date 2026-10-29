// SPDX-License-Identifier: Apache-2.0
import Box from '@cloudscape-design/components/box';
import Icon from '@cloudscape-design/components/icon';

/**
 * The trail above the title: Workflows, then the workflow that is open. The
 * page has no list of workflows yet, so no crumb is a link; the last one is
 * the current page.
 */
export function Breadcrumbs({ workflowName }: { workflowName?: string }) {
  return (
    <nav aria-label="Breadcrumbs">
      <ol className="wf-crumbs">
        <li>
          <Box variant="span" color="text-body-secondary">
            Workflows
          </Box>
        </li>
        {workflowName && (
          <>
            <li aria-hidden="true">
              <Box variant="span" color="text-body-secondary">
                <Icon name="angle-right" />
              </Box>
            </li>
            <li aria-current="page">
              <Box variant="span" fontWeight="bold" color="text-body-secondary">
                {workflowName}
              </Box>
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}
