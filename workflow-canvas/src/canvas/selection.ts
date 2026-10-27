// SPDX-License-Identifier: Apache-2.0
import type { GraphNode } from '../graph';

/**
 * The nodes with the selection drawn on them. Only a stage can be selected,
 * and the selected one says so in its name for a screen reader.
 */
export function markSelectable(
  nodes: readonly GraphNode[],
  selectedId: string | undefined,
) {
  return nodes.map((node) => {
    const selected = node.id === selectedId;
    return {
      ...node,
      selected,
      selectable: node.type === 'stage',
      ariaLabel: selected ? `${node.ariaLabel}, selected` : node.ariaLabel,
    };
  });
}
