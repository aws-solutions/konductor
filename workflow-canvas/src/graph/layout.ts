// SPDX-License-Identifier: Apache-2.0

/** The width of each node kind. The intent is wider than a stage card. */
export const NODE_WIDTH = { intent: 360, stage: 300 } as const;
/** The height of each kind of node, as the node components draw them. */
export const NODE_HEIGHT = { intent: 88, stage: 108 } as const;
/** The empty space between one node and the next. */
export const NODE_GAP = 56;

/**
 * Places the items in one column, in order, centred on x = 0, with `NODE_GAP`
 * between them. Each item keeps its width and gains its position.
 */
export function stackDown<
  T extends { readonly width: number; readonly height: number },
>(items: readonly T[]) {
  let top = 0;
  return items.map((item) => {
    const placed = {
      ...item,
      position: { x: -item.width / 2, y: top },
    };
    top += item.height + NODE_GAP;
    return placed;
  });
}
