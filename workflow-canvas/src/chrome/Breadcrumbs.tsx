// SPDX-License-Identifier: Apache-2.0
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';

/**
 * The trail above the title: Workflows, then the workflow that is open. The
 * page has no list of workflows yet, so both stay on this page.
 */
export function Breadcrumbs({ workflowName }: { workflowName?: string }) {
  const items = [{ text: 'Workflows', href: '#' }];
  if (workflowName) items.push({ text: workflowName, href: '#' });
  return (
    <BreadcrumbGroup
      ariaLabel="Breadcrumbs"
      items={items}
      onFollow={(event) => event.preventDefault()}
    />
  );
}
