// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { NODE_HEIGHT } from '../graph/layout';
import { dataLoopGeometry } from './DataLoopEdge';

describe('dataLoopGeometry', () => {
  it('routes below the card and places the label beside it', () => {
    const geometry = dataLoopGeometry({
      sourceX: 300,
      sourceY: 100,
      targetX: 0,
      targetY: 100,
    });

    expect(geometry.loopY).toBeGreaterThan(100 + NODE_HEIGHT.stage / 2);
    expect(geometry.labelX).toBeGreaterThan(300);
    expect(geometry.labelY).toBeGreaterThan(100);
  });
});
