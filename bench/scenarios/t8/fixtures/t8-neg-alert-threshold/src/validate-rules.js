#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const rulesDir = path.join(root, 'rules');
const allowedKinds = new Set(['threshold', 'ratio', 'absence', 'rate']);
const requiredRuleFields = ['name', 'kind', 'metric', 'threshold', 'operator', 'duration', 'labels', 'annotations'];

function fail(file, message) {
  throw new Error(`${path.relative(root, file)}: ${message}`);
}

function validateRule(file, rule) {
  for (const field of requiredRuleFields) {
    if (!(field in rule)) fail(file, `missing ${field}`);
  }
  if (typeof rule.name !== 'string' || rule.name.length === 0) fail(file, 'name must be a non-empty string');
  if (!allowedKinds.has(rule.kind)) fail(file, `unknown kind ${rule.kind}`);
  if (typeof rule.metric !== 'string' || rule.metric.length === 0) fail(file, 'metric must be a non-empty string');
  if (typeof rule.threshold !== 'number' || !Number.isFinite(rule.threshold)) fail(file, 'threshold must be finite');
  if (!['>', '<', '==', '>=', '<='].includes(rule.operator)) fail(file, 'invalid operator');
  if (!/^\d+[smhd]$/.test(rule.duration)) fail(file, 'duration must use a simple time unit');
  if (!rule.labels || typeof rule.labels !== 'object' || Array.isArray(rule.labels)) fail(file, 'labels must be an object');
  if (!rule.annotations || typeof rule.annotations !== 'object' || Array.isArray(rule.annotations)) fail(file, 'annotations must be an object');
}

function validateFile(file) {
  let document;
  try {
    document = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(file, `invalid JSON: ${error.message}`);
  }
  if (!document || typeof document !== 'object') fail(file, 'document must be an object');
  if (typeof document.service !== 'string' || !document.service) fail(file, 'service must be a non-empty string');
  if (document.schemaVersion !== 3) fail(file, 'schemaVersion must be 3');
  if (!Array.isArray(document.rules) || document.rules.length === 0) fail(file, 'rules must be a non-empty array');
  const names = new Set();
  for (const rule of document.rules) {
    validateRule(file, rule);
    if (names.has(rule.name)) fail(file, `duplicate rule ${rule.name}`);
    names.add(rule.name);
  }
}

const files = fs.readdirSync(rulesDir).filter((name) => name.endsWith('.json')).sort();
if (files.length === 0) throw new Error('rules directory is empty');
for (const name of files) validateFile(path.join(rulesDir, name));
console.log(`validated ${files.length} rule files`);
