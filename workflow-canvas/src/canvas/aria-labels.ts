// SPDX-License-Identifier: Apache-2.0
import type { AriaLabelConfig } from '@xyflow/react';

const READ_ONLY =
  'Read-only workflow graph. Nodes cannot be moved, selected or edited. Use the zoom controls to change the view.';

/**
 * Replaces the instructions of React Flow, which describe an editable graph,
 * with ones that are true on a read-only canvas.
 */
export const READ_ONLY_ARIA_LABELS: Partial<AriaLabelConfig> = {
  'node.a11yDescription.default': READ_ONLY,
  'node.a11yDescription.keyboardDisabled': READ_ONLY,
  'node.a11yDescription.ariaLiveMessage': () => '',
  'edge.a11yDescription.default': READ_ONLY,
};
