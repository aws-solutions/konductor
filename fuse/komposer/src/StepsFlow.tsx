// SPDX-License-Identifier: Apache-2.0
// The steps as a vertical flow: cards plus one SVG of arrows drawn from the
// measured card rectangles. Port of flowSvg() in the design prototype.

import { useLayoutEffect, useRef, useState } from "react";
import type { Artifact, Gate, Step, Workflow } from "./workflows.ts";

type Rect = { t: number; b: number; l: number; r: number };
type Edge = { j: number; i: number; lane: number };

const FWD = "var(--text-faint)";
const BACK = "oklch(0.62 0.13 65)";
// Horizontal centre of the number badge, from the card's left edge.
const BADGE_X = 24;
const R = 5;

const GATE_ICON: Record<Gate["kind"], string> = {
  "owner-action": "owner",
  check: "check",
  script: "script",
  agent: "agent",
};
const gateLabel = (gate: Gate) =>
  `${GATE_ICON[gate.kind]}: ${gate.description}${gate.maxRounds !== undefined ? ` (max ${gate.maxRounds} rounds)` : ""}${gate.guide ? ` (guide ${gate.guide})` : ""}`;
const artifactLabel: Record<Artifact["role"], string> = {
  produces: "produces",
  "optional-produces": "optional",
  updates: "updates",
};

// Greedy lanes: the shortest spans sit closest to the cards, and edges whose
// spans overlap never share a lane.
function assignLanes(edges: Edge[]): void {
  edges.sort((a, b) => a.i - a.j - (b.i - b.j));
  const placed: Edge[] = [];
  for (const edge of edges) {
    let lane = 0;
    while (placed.some((placedEdge) => placedEdge.lane === lane && !(placedEdge.i < edge.j || placedEdge.j > edge.i))) {
      lane++;
    }
    edge.lane = lane;
    placed.push(edge);
  }
}

function Arrows({ steps, geo }: { steps: Step[]; geo: Rect[] }) {
  if (geo.length !== steps.length || geo.length === 0) return null;
  const index = new Map(steps.map((step, i) => [step.id, i]));
  const latestArtifactStep = new Map<string, number>();
  const seq: Edge[] = [];
  const left: Edge[] = [];
  const right: Edge[] = [];

  steps.forEach((step, i) => {
    const dependencies =
      step.consumes.length === 0
        ? i > 0
          ? [i - 1]
          : []
        : [
            ...new Set(
              step.consumes
                .map((artifact) => latestArtifactStep.get(artifact))
                .filter((producer): producer is number => producer !== undefined),
            ),
          ];
    for (const producer of dependencies) {
      (producer === i - 1 ? seq : left).push({ j: producer, i, lane: 0 });
    }
    for (const artifact of step.artifacts) latestArtifactStep.set(artifact.id, i);
    for (const target of step.routesBackTo) {
      const targetIndex = index.get(target);
      if (targetIndex !== undefined && targetIndex <= i) right.push({ j: targetIndex, i, lane: 0 });
    }
  });
  assignLanes(left);
  assignLanes(right);

  const geometry = geo;
  return (
    <svg className="flow-svg">
      <defs>
        {[
          ["ah", FWD],
          ["ah-back", BACK],
        ].map(([id, color]) => (
          <marker
            key={id}
            id={id}
            viewBox="0 0 6 6"
            refX={5}
            refY={3}
            markerWidth={6}
            markerHeight={6}
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M0 0 L6 3 L0 6 z" style={{ fill: color }} />
          </marker>
        ))}
      </defs>
      {seq.map((edge) => {
        const x = geometry[edge.i].l + BADGE_X;
        return <Line key={`s${edge.j}-${edge.i}`} d={`M${x} ${geometry[edge.j].b} V${geometry[edge.i].t - 1}`} color={FWD} marker="ah" />;
      })}
      {left.map((edge) => {
        const leftEdge = geometry[edge.i].l;
        const x = leftEdge - 12 - edge.lane * 7;
        const startY = geometry[edge.j].b - 12;
        const endY = geometry[edge.i].t + 14;
        const d = `M${leftEdge} ${startY} H${x + R} Q${x} ${startY} ${x} ${startY + R} V${endY - R} Q${x} ${endY} ${x + R} ${endY} H${leftEdge - 1}`;
        return <Line key={`l${edge.j}-${edge.i}`} d={d} color={FWD} marker="ah" />;
      })}
      {right.map((edge) => {
        const rightEdge = geometry[edge.i].r;
        const x = rightEdge + 12 + edge.lane * 7;
        const startY = geometry[edge.i].b - 10;
        const endY = geometry[edge.j].t + 10;
        const d = `M${rightEdge} ${startY} H${x - R} Q${x} ${startY} ${x} ${startY - R} V${endY + R} Q${x} ${endY} ${x - R} ${endY} H${rightEdge + 1}`;
        return <Line key={`r${edge.j}-${edge.i}`} d={d} color={BACK} marker="ah-back" dashed />;
      })}
    </svg>
  );
}

function Line({ d, color, marker, dashed }: { d: string; color: string; marker: string; dashed?: boolean }) {
  return (
    <path
      d={d}
      fill="none"
      markerEnd={`url(#${marker})`}
      style={{ stroke: color, strokeWidth: 1.25, strokeDasharray: dashed ? "4 3" : "none" }}
    />
  );
}

function ArtifactChip({ artifact }: { artifact: Artifact }) {
  return (
    <span
      className={`chip artifact ${artifact.role}`}
      title={`${artifactLabel[artifact.role]} ${artifact.id}: ${artifact.path}`}
    >
      <span className="artifact-role">{artifactLabel[artifact.role]}</span>
      <span className="artifact-id">{artifact.id}</span>
      <span className="artifact-path">{artifact.path}</span>
    </span>
  );
}

function StepCard({ step, num }: { step: Step; num: number }) {
  return (
    <div className={`card${step.condition ? " is-optional" : ""}`} data-node={num}>
      <div className="badge">{num}</div>
      <div className="card-main">
        <div className="card-row">
          <div className="card-title">{step.title}</div>
          {step.phase && <span className="phase">{step.phase}</span>}
          <div className="card-id">{step.id}</div>
          {step.condition && (
            <span className={`condition ${step.condition.kind}`} title={`${step.condition.kind}: ${step.condition.description}`}>
              optional: {gateLabel(step.condition)}
            </span>
          )}
          {step.gates.map((gate, index) => (
            <span key={index} className={`gate ${gate.kind}`} title={`${gate.kind}: ${gate.description}`}>
              {gateLabel(gate)}
            </span>
          ))}
        </div>
        {step.artifacts.length > 0 && (
          <div className="chips">
            {step.artifacts.map((artifact, index) => (
              <ArtifactChip key={`${artifact.role}-${artifact.id}-${artifact.path}-${index}`} artifact={artifact} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function StepsFlow({ workflow }: { workflow: Workflow }) {
  const flowRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Rect[]>([]);

  useLayoutEffect(() => {
    const element = flowRef.current;
    if (!element) return;
    let key = "";
    const measure = () => {
      const box = element.getBoundingClientRect();
      const rects = Array.from(element.querySelectorAll("[data-node]")).map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          t: Math.round(rect.top - box.top),
          b: Math.round(rect.bottom - box.top),
          l: Math.round(rect.left - box.left),
          r: Math.round(rect.right - box.left),
        };
      });
      const next = JSON.stringify(rects);
      if (next !== key) {
        key = next;
        setGeo(rects);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [workflow]);

  return (
    <>
      <div className="steps-kicker">
        <span style={{ flex: 1 }}>// Steps · {workflow.steps.length}</span>
        <span className="legend">
          <span className="legend-line" />
          consumes / runs after
        </span>
        <span className="legend on-fail">
          <span className="legend-line" />
          route back
        </span>
      </div>
      <div className="flow" ref={flowRef}>
        <Arrows steps={workflow.steps} geo={geo} />
        {workflow.steps.map((step, index) => (
          <div key={`${step.id}-${index}`}>
            <div className="seam" />
            <StepCard step={step} num={index + 1} />
          </div>
        ))}
      </div>
    </>
  );
}
