// SPDX-License-Identifier: Apache-2.0
'use strict';

// Validator for the JSON Schema subset used by bench/schema/*.json:
// type (string or list), enum, const, anyOf, required, properties, additionalProperties:false,
// items, minItems, minLength, maxLength, minimum, pattern. No external dependencies.

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_DIR = path.join(__dirname, '..', '..', 'schema');

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function typeMatches(want, v) {
  const t = typeOf(v);
  return want === t || (want === 'number' && t === 'integer');
}

function validate(schema, value, at = '$') {
  const errors = [];
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}: must be one of ${JSON.stringify(schema.enum)}`);
  }
  if (schema.type) {
    const wanted = [].concat(schema.type);
    if (!wanted.some((w) => typeMatches(w, value))) {
      errors.push(`${at}: expected ${wanted.join('|')}, got ${typeOf(value)}`);
      return errors;
    }
  }
  if (schema.anyOf) {
    const branches = schema.anyOf.map((s) => validate(s, value, at));
    if (!branches.some((e) => !e.length)) errors.push(`${at}: matches none of ${branches.length} allowed shapes (${branches.map((e) => e.join('; ')).join(' | ')})`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: shorter than ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${at}: longer than ${schema.maxLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${at}: does not match ${schema.pattern}`);
    }
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${at}: below minimum ${schema.minimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${at}: fewer than ${schema.minItems} items`);
    }
    if (schema.items) {
      value.forEach((item, i) => errors.push(...validate(schema.items, item, `${at}[${i}]`)));
    }
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${at}: missing required "${key}"`);
    }
    const props = schema.properties || {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in value) errors.push(...validate(sub, value[key], `${at}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) errors.push(`${at}: unexpected property "${key}"`);
      }
    }
  }
  return errors;
}

// Read once per process: a run validates every result.json, and the checkout under it can change (a branch switch)
// while a study runs. `preloadSchemas` reads them all when a command starts.
const loaded = new Map();

function loadSchema(name) {
  if (!loaded.has(name)) loaded.set(name, JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), 'utf8')));
  return loaded.get(name);
}

/** Reads every schema now and returns their names. Throws, naming the file, when one is missing or not JSON. */
function preloadSchemas(required = ['result', 'task']) {
  let names;
  try { names = fs.readdirSync(SCHEMA_DIR).filter((n) => n.endsWith('.schema.json')).map((n) => n.slice(0, -'.schema.json'.length)); } catch (e) { throw new Error(`bench schema directory ${SCHEMA_DIR} cannot be read: ${e.message}`); }
  for (const r of required) if (!names.includes(r)) throw new Error(`bench file missing: ${path.join(SCHEMA_DIR, `${r}.schema.json`)}; the checkout the runner runs from is incomplete`);
  for (const n of names) {
    try { loadSchema(n); } catch (e) { throw new Error(`bench file ${path.join(SCHEMA_DIR, `${n}.schema.json`)} cannot be read: ${e.message}`); }
  }
  return names.sort();
}

module.exports = { validate, loadSchema, preloadSchemas, SCHEMA_DIR };
