// SPDX-License-Identifier: Apache-2.0
// Copied from Michael Lin's scripts/bench/lib/read-file.js (pull request #227, at commit 33b385f9), same repository and Apache-2.0 licence. Behaviour unchanged.
/**
 * Reading JSON files so that a failure always says which file failed and why, and a repeated key is refused.
 *
 *   readFile      `fs.readFileSync` that adds `path` to a read error (Node leaves it off some, such as EISDIR).
 *   parseJson     JSON text to a value. It drops a leading UTF-8 byte order mark and refuses an object that has the
 *                 same key twice, because `JSON.parse` keeps the last one and the earlier value would vanish silently.
 *   readJsonFile  readFile + parseJson.
 *
 * A file that cannot be parsed throws JsonFileError: `detail` finishes the sentence "<file>: ...", and `message` is
 * `<file>: <detail>`. A read failure is not wrapped: it is the system error from `fs`, with `path` set.
 */
'use strict';

const fs = require('node:fs');

const BYTE_ORDER_MARK = '\uFEFF';

/**
 * Reads a file and makes sure a read error names it.
 * @param {string} file the path to read
 * @param {string} [encoding] passed to fs.readFileSync; omit it for a Buffer
 */
function readFile(file, encoding) {
  try {
    return fs.readFileSync(file, encoding);
  } catch (error) {
    if (error && typeof error === 'object' && error.path === undefined) error.path = file;
    throw error;
  }
}

/** A file whose text is not usable JSON. `file` is the path, `detail` the reason that follows "<file>: ". */
class JsonFileError extends Error {
  constructor(file, detail) {
    super(`${file}: ${detail}`);
    this.name = 'JsonFileError';
    this.file = file;
    this.detail = detail;
  }
}

/** The path of the value a frame is filling: its parent's path plus the key or index it is at. */
const pathBelow = (parent) => {
  if (!parent) return '';
  if (!parent.isObject) return `${parent.path}[${parent.index}]`;
  return parent.path ? `${parent.path}.${parent.key}` : parent.key;
};

/**
 * The first object key that appears twice in the same object of `text`, as { key, path, line }, or null. `text` must
 * already be valid JSON, so the scan only tells strings from structure. `path` is where the object is ("" at the top),
 * `line` the line of the second use, counted from 1.
 */
function findDuplicateKey(text) {
  // One frame per open object or array; an object frame holds the keys seen so far.
  const frames = [];
  let line = 1;
  for (let position = 0; position < text.length; position += 1) {
    const character = text[position];
    const top = frames[frames.length - 1];
    if (character === '\n') {
      line += 1;
    } else if (character === '"') {
      let end = position + 1;
      while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      if (top && top.isObject && top.expectKey) {
        const key = JSON.parse(text.slice(position, end + 1));
        if (top.keys.has(key)) return { key, path: top.path, line };
        top.keys.add(key);
        top.key = key;
        top.expectKey = false;
      }
      position = end;
    } else if (character === '{' || character === '[') {
      frames.push({ isObject: character === '{', path: pathBelow(top), keys: new Set(), key: null, expectKey: true, index: 0 });
    } else if (character === '}' || character === ']') {
      frames.pop();
    } else if (character === ',' && top) {
      if (top.isObject) top.expectKey = true;
      else top.index += 1;
    }
  }
  return null;
}

/**
 * Parses JSON text and refuses a repeated key.
 * @param {string} text the JSON text
 * @param {string} file the file it came from, named in the error
 */
function parseJson(text, file) {
  const source = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new JsonFileError(file, `cannot be read as JSON (${error.message})`);
  }
  const duplicate = findDuplicateKey(source);
  if (duplicate) {
    const where = duplicate.path ? `in ${duplicate.path}` : 'at the top level';
    throw new JsonFileError(file, `has the key ${JSON.stringify(duplicate.key)} twice ${where} (line ${duplicate.line}); remove one, because JSON readers keep only the last`);
  }
  return value;
}

/** Reads and parses the JSON file at `file`. A read failure throws the system error; bad content throws JsonFileError. */
const readJsonFile = (file) => parseJson(readFile(file, 'utf8'), file);

module.exports = { readFile, parseJson, readJsonFile, JsonFileError, findDuplicateKey };
