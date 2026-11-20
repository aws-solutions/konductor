'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('./parser');
const { Settings } = require('./settings');

function defaultFiles() {
  const base = path.resolve(process.cwd(), 'config/default.env');
  const local = path.resolve(process.cwd(), 'config/local.env');
  return fs.existsSync(local) ? [base, local] : [base];
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function placeholderEnd(text, start) {
  let depth = 1;
  for (let index = start + 2; index < text.length; index += 1) {
    if (text.startsWith('${', index)) {
      depth += 1;
      index += 1;
    } else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitExpression(expression) {
  let depth = 0;
  for (let index = 0; index < expression.length - 1; index += 1) {
    if (expression.startsWith('${', index)) {
      depth += 1;
      index += 1;
    } else if (expression[index] === '}' && depth > 0) {
      depth -= 1;
    } else if (expression[index] === ':' && expression[index + 1] === '-' && depth === 0) {
      return [expression.slice(0, index), expression.slice(index + 2)];
    }
  }
  return [expression, undefined];
}

function expansionError(topKey, source, message) {
  return new Error(`${message} while expanding ${topKey} in ${source}`);
}

function expandValues(values, env, sources) {
  const expanded = {};

  function expandTemplate(text, topKey, source, stack) {
    let output = '';
    for (let index = 0; index < text.length;) {
      if (text[index] === '\\' && text.startsWith('${', index + 1)) {
        const end = placeholderEnd(text, index + 1);
        if (end < 0) {
          output += text[index++];
        } else {
          output += text.slice(index + 1, end + 1);
          index = end + 1;
        }
      } else if (text.startsWith('${', index)) {
        const end = placeholderEnd(text, index);
        if (end < 0) throw expansionError(topKey, source, 'Unclosed variable reference');
        const [rawName, defaultText] = splitExpression(text.slice(index + 2, end));
        const name = rawName.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          throw expansionError(topKey, source, `Invalid variable name ${name}`);
        }
        output += resolveVariable(name, defaultText, topKey, source, stack);
        index = end + 1;
      } else {
        output += text[index++];
      }
    }
    return output;
  }

  function resolveVariable(name, defaultText, topKey, source, stack) {
    const available = has(values, name) || has(env, name);
    if (!available) {
      if (defaultText !== undefined) return expandTemplate(defaultText, topKey, source, stack);
      throw expansionError(topKey, source, `Missing variable ${name}`);
    }
    const value = has(values, name) ? values[name] : String(env[name]);
    if (value === '' && defaultText !== undefined) return expandTemplate(defaultText, topKey, source, stack);
    if (stack.includes(name)) {
      const cycle = [...stack, name].join(' -> ');
      throw expansionError(topKey, source, `Reference cycle ${cycle}`);
    }
    return expandTemplate(value, topKey, source, [...stack, name]);
  }

  for (const key of Object.keys(values)) {
    const source = sources[key] || '<input>';
    expanded[key] = expandTemplate(values[key], key, source, [key]);
  }
  return expanded;
}

function loadSettings(options = {}) {
  const files = options.files === undefined ? defaultFiles() : options.files;
  const env = options.env === undefined ? process.env : options.env;
  if (!Array.isArray(files)) throw new TypeError('files must be an array');
  const values = {};
  const sources = {};
  for (const file of files) {
    const resolved = path.resolve(file);
    const parsed = parseEnv(fs.readFileSync(resolved, 'utf8'), resolved);
    for (const [key, value] of Object.entries(parsed)) {
      values[key] = value;
      sources[key] = resolved;
    }
  }
  for (const key of Object.keys(values)) {
    if (has(env, key) && env[key] !== undefined) {
      values[key] = String(env[key]);
      sources[key] = '<environment>';
    }
  }
  const resolved = options.expand === false ? values : expandValues(values, env, sources);
  return new Settings(resolved, { sources });
}

module.exports = { loadSettings, expandValues };
