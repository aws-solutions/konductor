// SPDX-License-Identifier: Apache-2.0
import { useReactFlow, useStore, type ReactFlowState } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { FIT_PADDING } from './view';

// How many nodes the canvas holds, and whether every one has been measured.
function measuredNodes(state: ReactFlowState): string {
  const nodes = [...state.nodeLookup.values()];
  const measured = nodes.every((node) => node.measured.width !== undefined);
  return `${nodes.length}:${measured}`;
}

/**
 * Fits the graph in the view again when it gains or loses a node, once every
 * node is measured, so an added stage is never out of sight. It draws
 * nothing. It must be a child of the canvas.
 */
export function FitWhenGrown({ count }: { count: number }) {
  const { fitView } = useReactFlow();
  const seen = useStore(measuredNodes);
  const fitted = useRef(count);
  useEffect(() => {
    if (seen !== `${count}:true` || fitted.current === count) return;
    fitted.current = count;
    void fitView({ padding: FIT_PADDING, maxZoom: 1 });
  }, [seen, count, fitView]);
  return null;
}
