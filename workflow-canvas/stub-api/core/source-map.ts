// SPDX-License-Identifier: Apache-2.0

export interface Position {
  line: number;
  column: number;
}

/**
 * Turns offsets in a text into the line and column of the contract. A line
 * ends at LF, CRLF or a lone CR, and a column counts code points from 1.
 */
export class SourceMap {
  private readonly text: string;
  private readonly lineStarts: number[] = [0];

  constructor(text: string) {
    this.text = text;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      if (char === 13 && text.charCodeAt(i + 1) === 10) i++;
      else if (char !== 10 && char !== 13) continue;
      this.lineStarts.push(i + 1);
    }
  }

  position(offset: number): Position {
    const line = this.lineIndexOf(offset);
    const lineText = this.text.slice(this.lineStarts[line], offset);
    return { line: line + 1, column: [...lineText].length + 1 };
  }

  // The last line that starts at or before the offset.
  private lineIndexOf(offset: number): number {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((this.lineStarts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  }
}
