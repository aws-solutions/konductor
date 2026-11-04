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

const SELECTABLE =
  'Workflow graph node. On a stage, press Enter or Space to edit it in Properties. The intent and the end cannot be edited.';

/**
 * Instructions for a canvas on which a stage can be selected. Nothing else
 * can be done to a node, and the nodes still cannot be moved or connected.
 */
export const SELECTABLE_ARIA_LABELS: Partial<AriaLabelConfig> = {
  'node.a11yDescription.default': SELECTABLE,
  'node.a11yDescription.keyboardDisabled': SELECTABLE,
  'node.a11yDescription.ariaLiveMessage': () => '',
  'edge.a11yDescription.default': SELECTABLE,
};
