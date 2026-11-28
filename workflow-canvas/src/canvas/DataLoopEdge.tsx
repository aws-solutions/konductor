// SPDX-License-Identifier: Apache-2.0
import { BaseEdge, type EdgeProps } from '@xyflow/react';
import { NODE_HEIGHT } from '../graph/layout';

const SIDE_GAP = 48;
const CORNER_RADIUS = 12;
const CARD_CLEARANCE = 24;

interface DataLoopCoordinates {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

export function dataLoopGeometry({
  sourceX,
  sourceY,
  targetX,
  targetY,
}: DataLoopCoordinates) {
  const rightX = Math.max(sourceX, targetX) + SIDE_GAP;
  const leftX = Math.min(sourceX, targetX) - SIDE_GAP;
  const loopY =
    Math.max(sourceY, targetY) + NODE_HEIGHT.stage / 2 + CARD_CLEARANCE;
  return {
    loopY,
    labelX: rightX,
    labelY: (sourceY + loopY) / 2,
    path: [
      `M ${sourceX} ${sourceY}`,
      `H ${rightX - CORNER_RADIUS}`,
      `Q ${rightX} ${sourceY} ${rightX} ${sourceY + CORNER_RADIUS}`,
      `V ${loopY - CORNER_RADIUS}`,
      `Q ${rightX} ${loopY} ${rightX - CORNER_RADIUS} ${loopY}`,
      `H ${leftX + CORNER_RADIUS}`,
      `Q ${leftX} ${loopY} ${leftX} ${loopY - CORNER_RADIUS}`,
      `V ${targetY + CORNER_RADIUS}`,
      `Q ${leftX} ${targetY} ${targetX} ${targetY}`,
    ].join(' '),
  };
}

export function DataLoopEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  label,
  labelStyle,
  labelShowBg,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  markerStart,
  markerEnd,
  interactionWidth,
  style,
}: EdgeProps) {
  const geometry = dataLoopGeometry({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });
  return (
    <BaseEdge
      path={geometry.path}
      label={label}
      labelX={geometry.labelX}
      labelY={geometry.labelY}
      labelStyle={labelStyle}
      labelShowBg={labelShowBg}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      markerStart={markerStart}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth}
      style={style}
    />
  );
}
