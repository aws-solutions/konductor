// SPDX-License-Identifier: Apache-2.0
// The steps as a vertical flow: cards plus one SVG of arrows drawn from the
// measured card rectangles. Port of flowSvg() in the design prototype.

import { useLayoutEffect, useRef, useState } from "react";
import type { Gate, Step, Workflow } from "./workflows.ts";

type Rect = { t: number; b: number; l: number; r: number };
type Edge = { j: number; i: number; lane: number };

const FWD = "var(--text-faint)";
const BACK = "oklch(0.62 0.13 65)";
// Horizontal centre of the number badge, from the card's left edge.
const BADGE_X = 24;
const R = 5;

const skillName = (p: string) => p.replace(/\/SKILL\.md$/, "").split("/").pop() ?? p;
const baseName = (p: string) => p.split("/").pop() ?? p;
const gateLabel = (g: Gate) => (g.kind === "check" ? `check: ${g.command}` : g.kind === "review" ? "review loop" : "owner");

// Greedy lanes: the shortest spans sit closest to the cards, and edges whose
// spans overlap never share a lane.
function assignLanes(edges: Edge[]): void {
  edges.sort((a, b) => a.i - a.j - (b.i - b.j));
  const placed: Edge[] = [];
  for (const e of edges) {
    let lane = 0;
    while (placed.some((p) => p.lane === lane && !(p.i < e.j || p.j > e.i))) lane++;
    e.lane = lane;
    placed.push(e);
  }
}

function Arrows({ steps, geo }: { steps: Step[]; geo: Rect[] }) {
  if (geo.length !== steps.length || geo.length === 0) return null;
  const index = new Map(steps.map((s, i) => [s.id, i]));
  const seq: Edge[] = [];
  const left: Edge[] = [];
  const right: Edge[] = [];
  steps.forEach((st, i) => {
    const deps =
      st.dependsOn === null
        ? i > 0
          ? [i - 1]
          : []
        : st.dependsOn.map((d) => index.get(d)).filter((j): j is number => j !== undefined && j < i);
    for (const j of deps) (j === i - 1 ? seq : left).push({ j, i, lane: 0 });
    const f = st.onFail === null ? undefined : index.get(st.onFail);
    if (f !== undefined && f <= i) right.push({ j: f, i, lane: 0 });
  });
  assignLanes(left);
  assignLanes(right);

  const g = geo;
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
      {seq.map((e) => {
        const x = g[e.i].l + BADGE_X;
        return <Line key={`s${e.i}`} d={`M${x} ${g[e.j].b} V${g[e.i].t - 1}`} color={FWD} marker="ah" />;
      })}
      {left.map((e) => {
        const L = g[e.i].l;
        const X = L - 12 - e.lane * 7;
        const y0 = g[e.j].b - 12;
        const y1 = g[e.i].t + 14;
        const d = `M${L} ${y0} H${X + R} Q${X} ${y0} ${X} ${y0 + R} V${y1 - R} Q${X} ${y1} ${X + R} ${y1} H${L - 1}`;
        return <Line key={`l${e.j}-${e.i}`} d={d} color={FWD} marker="ah" />;
      })}
      {right.map((e) => {
        const Rx = g[e.i].r;
        const X = Rx + 12 + e.lane * 7;
        const yo = g[e.i].b - 10;
        const yi = g[e.j].t + 10;
        const d = `M${Rx} ${yo} H${X - R} Q${X} ${yo} ${X} ${yo - R} V${yi + R} Q${X} ${yi} ${X - R} ${yi} H${Rx + 1}`;
        return <Line key={`r${e.j}-${e.i}`} d={d} color={BACK} marker="ah-back" dashed />;
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

function StepCard({ step, num }: { step: Step; num: number }) {
  const hasChips = step.skills.length + step.produces.length > 0;
  return (
    <div className="card" data-node={num}>
      <div className="badge">{num}</div>
      <div className="card-main">
        <div className="card-row">
          <div className="card-title">{step.title}</div>
          <div className="card-id">{step.id}</div>
          {step.gates.map((g, k) => (
            <span key={k} className={`gate ${g.kind}`} title={g.kind === "review" ? g.skill : undefined}>
              {gateLabel(g)}
            </span>
          ))}
          {step.maxFixCycles !== null && (
            <span className="gate fix-cycles" title="max fix cycles for this step (overrides the workflow's)">
              ↻ {step.maxFixCycles}
            </span>
          )}
        </div>
        {hasChips && (
          <div className="chips">
            {step.produces.map((p) => (
              <span key={p} className="chip artifact" title={p}>
                <span className="arrow">→</span>
                {baseName(p)}
              </span>
            ))}
            <span className="chips-skills">
              {step.skills.map((p) => (
                <span key={p} className="chip skill" title={p}>
                  {skillName(p)}
                </span>
              ))}
            </span>
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
    const el = flowRef.current;
    if (!el) return;
    let key = "";
    const measure = () => {
      const box = el.getBoundingClientRect();
      const rects = Array.from(el.querySelectorAll("[data-node]")).map((n) => {
        const r = n.getBoundingClientRect();
        return {
          t: Math.round(r.top - box.top),
          b: Math.round(r.bottom - box.top),
          l: Math.round(r.left - box.left),
          r: Math.round(r.right - box.left),
        };
      });
      const next = JSON.stringify(rects);
      if (next !== key) {
        key = next;
        setGeo(rects);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [workflow]);

  return (
    <>
      <div className="steps-kicker">
        <span style={{ flex: 1 }}>// Steps · {workflow.steps.length}</span>
        <span className="legend">
          <span className="legend-line" />
          runs after
        </span>
        <span className="legend on-fail">
          <span className="legend-line" />
          on fail
        </span>
      </div>
      <div className="flow" ref={flowRef}>
        <Arrows steps={workflow.steps} geo={geo} />
        {workflow.steps.map((s, i) => (
          <div key={`${s.id}-${i}`}>
            <div className="seam" />
            <StepCard step={s} num={i + 1} />
          </div>
        ))}
      </div>
    </>
  );
}
