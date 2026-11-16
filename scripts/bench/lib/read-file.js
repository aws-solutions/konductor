// SPDX-License-Identifier: Apache-2.0
/**
 * Reading files so that a failure always says which file failed and why.
 *
 *   readFile      `fs.readFileSync` that adds `path` to a read error. Node leaves `path` off some of them
 *                 (reading a folder as a file gives EISDIR with no path), and the driver prints
 *                 "error: <what> (<file>)" from it.
 *   parseJson     JSON text to a value: the one parser for every JSON file the bench reads. It drops a leading
 *                 UTF-8 byte order mark (Windows editors add one) and refuses an object that has the same
 *                 key twice, because `JSON.parse` keeps the last one and the earlier record would vanish
 *                 without a word.
 *   readJsonFile  readFile + parseJson.
 *
 * A file that cannot be parsed throws JsonFileError. Its `detail` finishes the sentence "<file>: ...",
 * for a caller that builds its own message; `message` is `<file>: <detail>`. This module does not wrap
 * a read failure: it is the system error from `fs`, with `path` set. A caller may reword it; loadConfig
 * (config.js) does, into a plain Error that names the file and the error code.
 */
'use strict';

const fs = require('fs');

const BYTE_ORDER_MARK = '\uFEFF';

function readFile(file, encoding) {
  try {
    return fs.readFileSync(file, encoding);
  } catch (error) {
    if (error && typeof error === 'object' && error.path === undefined)
      error.path = file;
    throw error;
  }
}

/** A file whose text is not usable JSON. */
class JsonFileError extends Error {
  constructor(file, detail) {
    super(`${file}: ${detail}`);
    this.name = 'JsonFileError';
    this.file = file;
    this.detail = detail;
  }
}

const KEY_PATH_SEPARATOR = '.';

/** The path of the value a frame is filling: its parent's path plus the key or index it is at. */
const pathBelow = (parent) => {
  if (!parent) return '';
  if (!parent.isObject) return `${parent.path}[${parent.index}]`;
  return parent.path
    ? `${parent.path}${KEY_PATH_SEPARATOR}${parent.key}`
    : parent.key;
};

/**
 * The first object key that appears twice in the same object of `text`, as { key, path, line }, or null.
 * `path` is where the object is ("" for the top level, "batches.b1", "rules[2]"); `line` counts from 1
 * and is the line of the second use. `text` must already be valid JSON, so the scan only has to tell
 * strings from structure and never reports a syntax error.
 */
function findDuplicateKey(text) {
  // One frame per open object or array. An object frame holds the keys seen so far.
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
      frames.push({
        isObject: character === '{',
        path: pathBelow(top),
        keys: new Set(),
        key: null,
        expectKey: true,
        index: 0,
      });
    } else if (character === '}' || character === ']') {
      frames.pop();
    } else if (character === ',' && top) {
      if (top.isObject) top.expectKey = true;
      else top.index += 1;
    }
  }
  return null;
}

/** Parses `text`, which was read from `file`. See the header for what it adds to `JSON.parse`. */
function parseJson(text, file) {
  const source = text.startsWith(BYTE_ORDER_MARK)
    ? text.slice(BYTE_ORDER_MARK.length)
    : text;
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new JsonFileError(file, `cannot be read as JSON (${error.message})`);
  }
  const duplicate = findDuplicateKey(source);
  if (duplicate) {
    const where = duplicate.path ? `in ${duplicate.path}` : 'at the top level';
    throw new JsonFileError(
      file,
      `has the key ${JSON.stringify(duplicate.key)} twice ${where} (line ${duplicate.line}); remove one, because JSON readers keep only the last`,
    );
  }
  return value;
}

/** Reads and parses a JSON file. A read failure throws the system error; bad content throws JsonFileError. */
const readJsonFile = (file) => parseJson(readFile(file, 'utf8'), file);

module.exports = { readFile, parseJson, readJsonFile, JsonFileError };
