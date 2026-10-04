// SPDX-License-Identifier: Apache-2.0
// Edge layout for the diagram: consumes buses (left gutter) and route-back
// lines (right gutter), with greedy lane assignment. Ported from the
// prototype's `layout()` / `flowSvg()` (Workflow Editor v2.dc.html).

import type { StepView } from "./workflowView.ts";

export interface Bus {
  artifact: string;
  producerIndex: number;
  consumerIndices: number[];
  lastConsumerIndex: number;
  lane: number;
}

export interface RouteBack {
  fromIndex: number; // the gate's step
  toIndex: number; // the target step
  from: string;
  to: string;
  lane: number;
}

export interface Layout {
  buses: Bus[];
  routes: RouteBack[];
  leftLanes: number;
  rightLanes: number;
}

export function layoutEdges(steps: StepView[]): Layout {
  // The first step to list each artifact in produces, optional_produces or
  // updates is its producer.
  const producedAt = new Map<string, number>();
  steps.forEach((step, i) => {
    for (const a of step.artifacts) {
      if (!producedAt.has(a.artifact)) producedAt.set(a.artifact, i);
    }
  });

  const buses: Bus[] = [];
  for (const [artifact, producerIndex] of producedAt) {
    const consumerIndices: number[] = [];
    steps.forEach((step, j) => {
      if (j > producerIndex && step.consumes.includes(artifact)) consumerIndices.push(j);
    });
    if (consumerIndices.length === 0) continue;
    buses.push({ artifact, producerIndex, consumerIndices, lastConsumerIndex: Math.max(...consumerIndices), lane: 0 });
  }
  buses.sort((a, b) => a.producerIndex - b.producerIndex || a.lastConsumerIndex - b.lastConsumerIndex);
  const laneEnd: number[] = [];
  for (const bus of buses) {
    let lane = 0;
    while (laneEnd[lane] !== undefined && laneEnd[lane] > bus.producerIndex) lane++;
    bus.lane = lane;
    laneEnd[lane] = bus.lastConsumerIndex;
  }

  const routes: RouteBack[] = [];
  steps.forEach((step, i) => {
    for (const gate of step.gates) {
      for (const target of gate.route_back_to) {
        const j = steps.findIndex((s) => s.id === target);
        if (j >= 0 && j <= i) routes.push({ fromIndex: i, toIndex: j, from: step.id, to: target, lane: 0 });
      }
    }
  });
  routes.sort((a, b) => a.fromIndex - a.toIndex - (b.fromIndex - b.toIndex));
  const placed: RouteBack[] = [];
  for (const route of routes) {
    let lane = 0;
    while (placed.some((p) => p.lane === lane && !(p.fromIndex < route.toIndex || p.toIndex > route.fromIndex))) lane++;
    route.lane = lane;
    placed.push(route);
  }

  return {
    buses,
    routes,
    leftLanes: laneEnd.length,
    rightLanes: routes.length ? Math.max(...routes.map((r) => r.lane)) + 1 : 0,
  };
}

// Sequence edges: between consecutive steps whose predecessor's artifacts
// are not already drawn as a labeled bus (every step draws a plain
// sequence arrow from the step before it; this is in addition to buses).
export function hasAnyEdges(layout: Layout): boolean {
  return layout.buses.length > 0 || layout.routes.length > 0;
}
