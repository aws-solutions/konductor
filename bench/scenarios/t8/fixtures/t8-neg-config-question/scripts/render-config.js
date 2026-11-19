#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_ROOT = path.join(__dirname, '..', 'config');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadEnvironment(environment) {
  const directory = path.join(CONFIG_ROOT, environment);
  if (!fs.existsSync(directory)) {
    throw new Error(`Unknown environment: ${environment}`);
  }

  const services = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json') && name !== 'overrides.json')
    .sort()
    .map((name) => readJson(path.join(directory, name)));

  const overridePath = path.join(directory, 'overrides.json');
  if (!fs.existsSync(overridePath)) return services;

  const overrides = readJson(overridePath).services || {};
  return services.map((service) => ({
    ...service,
    ...(overrides[service.service] || {}),
  }));
}

function render(environment) {
  return {
    environment,
    services: loadEnvironment(environment),
  };
}

if (require.main === module) {
  const environment = process.argv[2];
  if (!environment) {
    console.error('Usage: node scripts/render-config.js <environment>');
    process.exitCode = 2;
  } else {
    process.stdout.write(`${JSON.stringify(render(environment), null, 2)}\n`);
  }
}

module.exports = { loadEnvironment, render };
