// SPDX-License-Identifier: Apache-2.0
// The dark info tooltip shown on hovering a field's "i" icon: YAML key,
// required/optional, the schema description and a separate engine-effect
// line, positioned below the icon or above when there isn't room.

import { useState } from "react";
import { Info } from "lucide-react";
import type { FieldDoc } from "./docs.ts";

export function InfoTip({ doc }: { doc: FieldDoc }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const onEnter = (e: React.MouseEvent<HTMLSpanElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const below = r.bottom < window.innerHeight - 240;
    setPos({
      left: Math.max(8, Math.min(r.left + r.width / 2 - 155, window.innerWidth - 318)),
      ...(below ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }),
    });
  };

  return (
    <span className="info-tip-wrap" onMouseEnter={onEnter} onMouseLeave={() => setPos(null)}>
      <span className="info-icon" aria-label="field info">
        <Info size={10} strokeWidth={1.75} />
      </span>
      {pos && (
        <div className="info-tooltip" style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}>
          <div className="info-tooltip-key">
            {doc.yamlKey} <span className="info-tooltip-tag">{doc.required ? "required" : "optional"}</span>
          </div>
          <div className="info-tooltip-desc">{doc.description}</div>
          {doc.engineEffect && <div className="info-tooltip-effect">Engine effect: {doc.engineEffect}</div>}
        </div>
      )}
    </span>
  );
}

export function FieldLabel({ label, doc }: { label: string; doc: FieldDoc }) {
  return (
    <span className="field-label-row">
      {label}
      <span className={`field-tag ${doc.required ? "is-required" : "is-optional"}`}>
        {doc.required ? "required" : "optional"}
      </span>
      <InfoTip doc={doc} />
    </span>
  );
}
