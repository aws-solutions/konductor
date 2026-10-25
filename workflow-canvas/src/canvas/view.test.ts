// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../graph';
import { CANVAS_HEIGHT, FIT_PADDING, MIN_ZOOM } from './view';

// The most stages that api/openapi.yaml allows in a workflow.
const MAX_STAGES = 40;

describe('the canvas view', () => {
  it('can zoom out far enough to fit a workflow of the most stages', () => {
    const stages = Array.from({ length: MAX_STAGES }, (_, index) => ({
      name: `stage-${index}`,
      agent: 'k-developer',
    }));
    const { nodes } = buildGraph(
      { name: 'long', intent: { outcome: 'Do it' }, stages },
      'kiro-cli',
    );
    const last = nodes[nodes.length - 1];
    const graphHeight = (last?.position.y ?? 0) + (last?.height ?? 0);

    const zoomToFit = CANVAS_HEIGHT / (graphHeight * (1 + 2 * FIT_PADDING));

    expect(zoomToFit).toBeGreaterThanOrEqual(MIN_ZOOM);
  });
});
