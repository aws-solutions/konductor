// SPDX-License-Identifier: Apache-2.0

export interface DiffLine {
  kind: " " | "+" | "-";
  text: string;
}

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: " ", text: a[i++] });
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) out.push({ kind: "-", text: a[i++] });
    else out.push({ kind: "+", text: b[j++] });
  }
  while (i < a.length) out.push({ kind: "-", text: a[i++] });
  while (j < b.length) out.push({ kind: "+", text: b[j++] });
  return out;
}

export function visibleDiff(lines: DiffLine[]): (DiffLine | { kind: "…"; text: string })[] {
  const near = lines.map((_, i) => lines.slice(Math.max(0, i - 3), i + 4).some((line) => line.kind !== " "));
  const out: (DiffLine | { kind: "…"; text: string })[] = [];
  lines.forEach((line, i) => {
    if (near[i]) out.push(line);
    else if (near[i - 1]) out.push({ kind: "…", text: "…" });
  });
  return out;
}
