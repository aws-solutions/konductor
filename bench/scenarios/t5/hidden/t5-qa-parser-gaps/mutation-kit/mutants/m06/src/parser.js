"use strict";

const { tokenize } = require("./tokenizer");
const { ParseError } = require("./errors");
const { parseNumeric } = require("./values");

const MAX_SECTION_DEPTH = 8;

function parse(text) {
  const tokens = tokenize(text);
  const root = {};
  const locations = Object.create(null);
  const sectionPaths = new Set();
  let position = 0;
  let current = root;
  let currentPath = "";

  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const fail = (message, token = peek()) => {
    const line = token ? token.line : (tokens.at(-1)?.line || 1);
    const column = token ? token.column : (tokens.at(-1)?.column || 1);
    throw new ParseError(message, line, column);
  };

  const expect = (value) => {
    const token = take();
    if (!token || token.type !== "punct" || token.value !== value) fail(`expected '${value}'`, token);
    return token;
  };

  const parseValue = () => {
    const token = take();
    if (!token) fail("expected a value");
    if (token.type === "string") return token.value;
    if (token.type === "punct" && token.value === "[") {
      const list = [];
      if (peek()?.type === "punct" && peek().value === "]") {
        take();
        return list;
      }
      while (true) {
        list.push(parseValue());
        if (peek()?.type === "punct" && peek().value === ",") {
          take();
          if (peek()?.type === "punct" && peek().value === "]") {
            take();
            return list;
          }
          continue;
        }
        expect("]");
        return list;
      }
    }
    if (token.type !== "word") fail("expected a value", token);
    if (token.value === "true") return true;
    if (token.value === "false") return false;
    const numeric = parseNumeric(token.value, token.line, token.column);
    return numeric === null ? token.value : numeric;
  };

  const readKey = () => {
    const token = take();
    if (!token || (token.type !== "word" && token.type !== "string")) fail("expected a key", token);
    return token;
  };

  while (position < tokens.length) {
    if (peek().type === "punct" && peek().value === "[") {
      take();
      const parts = [];
      const first = readKey();
      parts.push(first.value);
      while (peek()?.type === "punct" && peek().value === ".") {
        take();
        parts.push(readKey().value);
      }
      expect("]");
      if (parts.length >= MAX_SECTION_DEPTH) fail(`sections may be at most ${MAX_SECTION_DEPTH} names deep`, first);
      const path = parts.join(".");
      if (sectionPaths.has(path)) fail("duplicate section", first);
      sectionPaths.add(path);
      current = root;
      const built = [];
      for (const part of parts) {
        built.push(part);
        if (current[part] === undefined) current[part] = {};
        else if (current[part] === null || typeof current[part] !== "object" || Array.isArray(current[part])) fail("section conflicts with a value", first);
        current = current[part];
      }
      currentPath = path;
      continue;
    }
    const keyToken = readKey();
    expect("=");
    const value = parseValue();
    if (Object.prototype.hasOwnProperty.call(current, keyToken.value)) fail(`duplicate key '${keyToken.value}'`, keyToken);
    current[keyToken.value] = value;
    const fullPath = currentPath ? `${currentPath}.${keyToken.value}` : keyToken.value;
    locations[fullPath] = { line: keyToken.line, column: keyToken.column };
  }
  Object.defineProperty(root, "__locations", { value: locations, enumerable: false });
  return root;
}

module.exports = { parse, MAX_SECTION_DEPTH };
