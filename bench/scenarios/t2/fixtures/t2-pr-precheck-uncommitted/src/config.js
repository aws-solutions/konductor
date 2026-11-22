'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJson(name) {
  const file = path.join(__dirname, '..', 'config', `${name}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function carrierSettings(defaults, selected) {
  const merged = { ...defaults.carrier, ...(selected.carrier || {}) };
  return {
    ...merged,
    url: process.env.CARRIER_URL || 'https://sandbox.carrier.test/v1/rates'
  };
}

function normaliseEnvironment(environment) {
  if (!environment || typeof environment !== 'string') return 'development';
  return environment.trim().toLowerCase();
}

function publicConfig(config) {
  return {
    port: config.port,
    cacheTtlMs: config.cacheTtlMs,
    carrierUrl: config.carrier.url,
    timeoutMs: config.carrier.timeoutMs
  };
}

function loadConfig(environment = process.env.NODE_ENV || 'development') {
  const defaults = readJson('defaults');
  const selected = readJson(normaliseEnvironment(environment));
  const carrier = carrierSettings(defaults, selected);
  return { ...defaults, ...selected, carrier };
}

module.exports = { loadConfig, carrierSettings, normaliseEnvironment, publicConfig };
