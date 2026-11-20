// Changes for this request; see the commit message for the reasoning.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ValidationError } = require('./errors');

const SHIPPING_CONFIG_PATH = path.join(__dirname, '..', 'config', 'shipping.json');
const BUILTIN_DEFAULTS = {
  freeShippingThresholdCents: 5000,
  standardShippingCents: 799
};

function invalidConfiguration(detail) {
  return new ValidationError(`Shipping configuration is invalid: ${detail}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateSettings(settings, label) {
  if (!isPlainObject(settings)) {
    throw invalidConfiguration(`${label} must be an object`);
  }
  for (const name of ['freeShippingThresholdCents', 'standardShippingCents']) {
    if (settings[name] !== undefined && (!Number.isInteger(settings[name]) || settings[name] < 0)) {
      throw invalidConfiguration(`${label}.${name} must be a non-negative integer`);
    }
  }
}

function readShippingConfiguration() {
  let contents;
  try {
    contents = fs.readFileSync(SHIPPING_CONFIG_PATH, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { default: {}, countries: {} };
    throw invalidConfiguration(`could not read ${error.message}`);
  }

  if (contents.trim() === '') return { default: {}, countries: {} };

  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw invalidConfiguration('file must contain valid JSON');
  }
  if (!isPlainObject(parsed)) {
    throw invalidConfiguration('top level must be an object');
  }

  const defaults = parsed.default === undefined ? {} : parsed.default;
  validateSettings(defaults, 'default');

  const countries = parsed.countries === undefined ? {} : parsed.countries;
  if (!isPlainObject(countries)) {
    throw invalidConfiguration('countries must be an object');
  }
  for (const [country, settings] of Object.entries(countries)) {
    validateSettings(settings, `countries.${country}`);
  }
  return { default: defaults, countries };
}

function calculateShipping(subtotalCents, options = {}) {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new ValidationError('Subtotal is invalid');
  }

  const configuration = readShippingConfiguration();
  const countrySettings = typeof options.country === 'string'
    ? configuration.countries[options.country] || {}
    : {};
  const configured = {
    ...BUILTIN_DEFAULTS,
    ...configuration.default,
    ...countrySettings
  };
  const threshold = options.freeShippingThresholdCents ?? configured.freeShippingThresholdCents;
  const standard = options.standardShippingCents ?? configured.standardShippingCents;

  if (!Number.isInteger(threshold) || threshold < 0 || !Number.isInteger(standard) || standard < 0) {
    throw new ValidationError('Shipping settings are invalid');
  }
  return subtotalCents >= threshold ? 0 : standard;
}

module.exports = { calculateShipping };
