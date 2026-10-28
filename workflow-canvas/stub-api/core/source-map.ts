// SPDX-License-Identifier: Apache-2.0

export interface Position {
  line: number;
  column: number;
}

/**
 * Turns offsets into the line and column of the contract: a line ends at LF,
 * CRLF or a lone CR, and a column counts code points. A lookup is a search.
 */
export class SourceMap {
  private readonly lineStarts: number[] = [0];
  // pairsBefore[i] is how many surrogate pairs end before offset i.
  private readonly pairsBefore: Uint32Array;

  constructor(text: string) {
    this.pairsBefore = new Uint32Array(text.length + 1);
    for (let i = 0; i < text.length; i++) {
      const pair = isLowHalf(text, i) && isHighHalf(text, i - 1);
      this.pairsBefore[i + 1] = (this.pairsBefore[i] ?? 0) + (pair ? 1 : 0);
    }
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      if (char === 13 && text.charCodeAt(i + 1) === 10) i++;
      else if (char !== 10 && char !== 13) continue;
      this.lineStarts.push(i + 1);
    }
  }

  position(offset: number): Position {
    const at = Math.min(offset, this.pairsBefore.length - 1);
    const line = this.lineIndexOf(at);
    const start = this.lineStarts[line] ?? 0;
    const pairs = this.pairsAt(at) - this.pairsAt(start);
    return { line: line + 1, column: at - start - pairs + 1 };
  }

  private pairsAt(offset: number): number {
    return this.pairsBefore[offset] ?? 0;
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

const isHighHalf = (text: string, index: number) =>
  text.charCodeAt(index) >= 0xd800 && text.charCodeAt(index) <= 0xdbff;

const isLowHalf = (text: string, index: number) =>
  text.charCodeAt(index) >= 0xdc00 && text.charCodeAt(index) <= 0xdfff;
