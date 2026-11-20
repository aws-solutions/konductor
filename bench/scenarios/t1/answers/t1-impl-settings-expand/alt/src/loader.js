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

class ExpansionError extends Error {
  constructor(message, settingName, sourceFile) {
    super(`${message} (setting: ${settingName}, source: ${sourceFile})`);
    this.name = 'ExpansionError';
    this.settingName = settingName;
    this.sourceFile = sourceFile;
  }
}

function expandOneValue(value, context) {
  const { values, sources, visited, expandStack, currentSource } = context;
  let result = '';
  let i = 0;
  
  while (i < value.length) {
    // Check for escaped placeholder \${...}
    if (value[i] === '\\' && i + 1 < value.length && value[i + 1] === '$') {
      // Skip the backslash, output the rest as literal
      i += 1;
      result += value[i];
      i += 1;
      continue;
    }
    
    // Check for placeholder ${...}
    if (value[i] === '$' && i + 1 < value.length && value[i + 1] === '{') {
      i += 2; // skip ${
      
      // Find the name (everything up to : or })
      let name = '';
      let hasDefault = false;
      let defaultValue = '';
      
      while (i < value.length && value[i] !== '}' && value[i] !== ':') {
        name += value[i];
        i += 1;
      }
      
      if (i < value.length && value[i] === ':') {
        i += 1; // skip :
        if (i < value.length && value[i] === '-') {
          hasDefault = true;
          i += 1; // skip -
          // Read default value until closing brace (respecting nesting)
          let braceDepth = 1;
          while (i < value.length && braceDepth > 0) {
            if (value[i] === '{') {
              defaultValue += value[i];
              braceDepth += 1;
            } else if (value[i] === '}') {
              braceDepth -= 1;
              if (braceDepth === 0) break;
              defaultValue += value[i];
            } else {
              defaultValue += value[i];
            }
            i += 1;
          }
        }
      }
      
      // Skip closing brace
      if (i < value.length && value[i] === '}') {
        i += 1;
      }
      
      // Resolve the name: settings from the merged files first, then names supplied only by env
      const sourceKey = name;
      const inValues = Object.prototype.hasOwnProperty.call(values, sourceKey);
      const inEnv = !inValues && Object.prototype.hasOwnProperty.call(context.env, sourceKey);
      
      if (!inValues && !inEnv && !hasDefault) {
        throw new ExpansionError(
          `missing reference: ${name}`,
          expandStack[0] || name,
          currentSource
        );
      }
      
      let resolvedValue = inValues ? values[sourceKey] : (inEnv ? String(context.env[sourceKey]) : '');
      
      // Check for cycles
      if (inValues && visited.has(sourceKey)) {
        throw new ExpansionError(
          `reference cycle detected: ${[...expandStack, sourceKey].join(' -> ')}`,
          expandStack[0] || sourceKey,
          currentSource
        );
      }
      
      // Expand the referenced value if it contains placeholders
      if (inValues && resolvedValue.includes('${')) {
        visited.add(sourceKey);
        expandStack.push(sourceKey);
        resolvedValue = expandOneValue(resolvedValue, context);
        expandStack.pop();
        visited.delete(sourceKey);
      }
      
      // Apply default if value is empty
      if (hasDefault) {
        if (resolvedValue === '') {
          // Recursively expand the default value
          resolvedValue = expandOneValue(defaultValue, context);
        }
      }
      
      result += resolvedValue;
      continue;
    }
    
    result += value[i];
    i += 1;
  }
  
  return result;
}

function expandValues(values, sources, env = {}) {
  const expanded = {};
  const context = {
    values,
    sources,
    visited: new Set(),
    expandStack: [],
    currentSource: null,
    env
  };
  
  for (const key of Object.keys(values)) {
    const value = values[key];
    context.visited.clear();
    context.expandStack = [key];
    context.currentSource = sources[key] || '<unknown>';
    
    if (value.includes('${')) {
      expanded[key] = expandOneValue(value, context);
    } else {
      expanded[key] = value;
    }
  }
  
  return expanded;
}

function loadSettings(options = {}) {
  const files = options.files === undefined ? defaultFiles() : options.files;
  const env = options.env === undefined ? process.env : options.env;
  const expand = options.expand === undefined ? true : Boolean(options.expand);
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
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      values[key] = String(env[key]);
      sources[key] = '<environment>';
    }
  }
  const finalValues = expand ? expandValues(values, sources, env) : values;
  return new Settings(finalValues, { sources });
}

module.exports = { loadSettings, ExpansionError };
