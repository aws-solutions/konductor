// SPDX-License-Identifier: Apache-2.0

/** Every node is as wide as this, so the order edges run straight down. */
export const NODE_WIDTH = 280;
/** The height of each kind of node, as the node components draw them. */
export const NODE_HEIGHT = { intent: 96, stage: 76, end: 44 } as const;
/** The empty space between one node and the next. */
export const NODE_GAP = 56;

/**
 * Places the items in one column, in order, centred on x = 0, with `NODE_GAP`
 * between them. Each item gains its width and position.
 */
export function stackDown<T extends { height: number }>(items: readonly T[]) {
  let top = 0;
  return items.map((item) => {
    const placed = {
      ...item,
      width: NODE_WIDTH,
      position: { x: -NODE_WIDTH / 2, y: top },
    };
    top += item.height + NODE_GAP;
    return placed;
  });
}
