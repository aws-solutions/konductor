"use strict";

const { ParseError } = require("./errors");

const punctuation = new Set(["=", "[", "]", ",", ".", ";"]);

class Tokenizer {
  constructor() {
    this.input = "";
    this.index = 0;
    this.line = 1;
    this.column = 1;
    this.tokens = [];
  }

  advance() {
    const ch = this.input[this.index++];
    if (ch === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return ch;
  }

  error(message, line = this.line, column = this.column) {
    throw new ParseError(message, line, column);
  }

  readString() {
    const line = this.line;
    const column = this.column;
    this.advance();
    let value = "";
    while (this.index < this.input.length) {
      const ch = this.advance();
      if (ch === '"') return { type: "string", value, line, column };
      if (ch !== "\\") {
        value += ch;
        continue;
      }
      if (this.index >= this.input.length) this.error("unterminated escape");
      const escaped = this.advance();
      const escapes = { "\\": "\\", '"': '"', n: "\n", r: "\r", t: "\t" };
      if (Object.prototype.hasOwnProperty.call(escapes, escaped)) {
        value += escapes[escaped];
      } else if (escaped === "u") {
        const hexLine = this.line;
        const hexColumn = this.column;
        const hex = this.input.slice(this.index, this.index + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.error("invalid Unicode escape", hexLine, hexColumn);
        for (let i = 0; i < 4; i += 1) this.advance();
        value += String.fromCharCode(parseInt(hex, 16));
      } else {
        this.error(`unknown escape \\${escaped}`);
      }
    }
    this.error("unterminated string", line, column);
  }

  tokenize(input) {
    this.input = String(input);
    this.index = 0;
    this.line = this.line;
    this.column = 1;
    this.tokens = [];
    while (this.index < this.input.length) {
      const ch = this.input[this.index];
      if (/\s/.test(ch)) {
        this.advance();
        continue;
      }
      if (ch === "#") {
        while (this.index < this.input.length && this.input[this.index] !== "\n") this.advance();
        continue;
      }
      if (ch === '"') {
        this.tokens.push(this.readString());
        continue;
      }
      if (punctuation.has(ch)) {
        this.tokens.push({ type: "punct", value: this.advance(), line: this.line, column: this.column - 1 });
        continue;
      }
      const line = this.line;
      const column = this.column;
      let value = "";
      while (this.index < this.input.length) {
        const current = this.input[this.index];
        const decimalDot = current === "." && /\d/.test(this.input[this.index - 1] || "") && /\d/.test(this.input[this.index + 1] || "");
        if (/\s/.test(current) || (punctuation.has(current) && !decimalDot) || current === "#" || current === '"') break;
        value += this.advance();
      }
      if (!value) this.error("unexpected character");
      this.tokens.push({ type: "word", value, line, column });
    }
    return this.tokens;
  }
}

function tokenize(input) {
  return new Tokenizer().tokenize(input);
}

module.exports = { Tokenizer, tokenize };
