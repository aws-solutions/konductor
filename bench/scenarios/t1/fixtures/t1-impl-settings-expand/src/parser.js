'use strict';

function syntaxError(source, lineNumber, message) {
  return new Error(`${source}:${lineNumber}: ${message}`);
}

function stripInlineComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if ((ch === "'" || ch === '"') && (i === 0 || value[i - 1] !== '\\')) {
      quote = quote === ch ? null : (quote || ch);
    }
    if (ch === '#' && !quote && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value.trim();
}

function unquote(value) {
  if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) {
    const body = value.slice(1, -1);
    return value[0] === '"' ? body.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : body;
  }
  return value;
}

function parseEnv(text, source = '<input>') {
  if (typeof text !== 'string') throw new TypeError('environment text must be a string');
  const result = {};
  text.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s?(.*)$/.exec(line);
    if (!match) throw syntaxError(source, lineNumber, 'expected KEY=VALUE');
    result[match[1]] = unquote(stripInlineComment(match[2]));
  });
  return result;
}

module.exports = { parseEnv };
