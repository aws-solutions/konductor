'use strict';

/**
 * Environment variable support for folder-syncer configuration.
 * Uses envPrefix from config (default SYNCER_) to resolve environment variables.
 */

const VALID_BOOLEANS = { true: true, false: false, '1': true, '0': false, yes: true, no: false };

/**
 * Convert an option name to an environment variable name.
 * Replaces hyphens with underscores and uppercases.
 * @param {string} optionName - The option name (e.g., 'dry-run')
 * @returns {string} - The environment variable name (e.g., 'DRY_RUN')
 */
function optionToEnvName(optionName) {
  return optionName.replace(/-/g, '_').toUpperCase();
}

/**
 * Get an environment variable value using the given prefix and option name.
 * An empty string is treated as unset.
 * @param {string} optionName - The option name
 * @param {string} prefix - The environment prefix (e.g., 'SYNCER_')
 * @returns {string|undefined} - The value or undefined if not set/empty
 */
function getEnvRaw(optionName, prefix) {
  const envName = prefix + optionToEnvName(optionName);
  const value = process.env[envName];
  return value === '' ? undefined : value;
}

/**
 * Parse a boolean environment variable value.
 * Accepts: true, false, 1, 0, yes, no (case-insensitive)
 * @param {string} value - The raw string value
 * @param {string} envName - The environment variable name for error messages
 * @returns {boolean} - The parsed boolean
 * @throws {Error} - If the value is not a valid boolean
 */
function parseEnvBoolean(value, envName) {
  const normalized = value.toLowerCase();
  if (!(normalized in VALID_BOOLEANS)) {
    throw new Error(`Invalid value for ${envName}: must be true, false, 1, 0, yes, or no`);
  }
  return VALID_BOOLEANS[normalized];
}

/**
 * Parse a positive integer environment variable value.
 * @param {string} value - The raw string value
 * @param {string} envName - The environment variable name for error messages
 * @returns {number} - The parsed positive integer
 * @throws {Error} - If the value is not a valid positive integer
 */
function parseEnvInteger(value, envName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`Invalid value for ${envName}: must be a positive integer`);
  }
  return number;
}

/**
 * Parse a comma-separated tag value into an array of tags.
 * @param {string} value - The raw string value (comma-separated)
 * @returns {string[]} - Array of tag strings
 */
function parseEnvTags(value) {
  return value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
}

/**
 * Resolve all configuration values from environment variables.
 * @param {object} config - The loaded JSON config (for envPrefix)
 * @returns {object} - Object with env-resolved values and their sources
 */
function resolveEnvValues(config) {
  const prefix = config.envPrefix || 'SYNCER_';
  const result = { values: {}, sources: {} };
  
  const stringOptions = ['source', 'bucket', 'prefix', 'region', 'config'];
  const booleanOptions = ['dry-run', 'verbose', 'show-config'];
  const integerOptions = ['concurrency'];
  const arrayOptions = ['tag'];
  
  for (const opt of stringOptions) {
    const raw = getEnvRaw(opt, prefix);
    if (raw !== undefined) {
      result.values[opt] = raw;
      result.sources[opt] = 'environment';
    }
  }
  
  for (const opt of booleanOptions) {
    const raw = getEnvRaw(opt, prefix);
    if (raw !== undefined) {
      const envName = prefix + optionToEnvName(opt);
      result.values[opt] = parseEnvBoolean(raw, envName);
      result.sources[opt] = 'environment';
    }
  }
  
  for (const opt of integerOptions) {
    const raw = getEnvRaw(opt, prefix);
    if (raw !== undefined) {
      const envName = prefix + optionToEnvName(opt);
      result.values[opt] = parseEnvInteger(raw, envName);
      result.sources[opt] = 'environment';
    }
  }
  
  for (const opt of arrayOptions) {
    const raw = getEnvRaw(opt, prefix);
    if (raw !== undefined) {
      result.values[opt] = parseEnvTags(raw);
      result.sources[opt] = 'environment';
    }
  }
  
  return result;
}

module.exports = {
  optionToEnvName,
  getEnvRaw,
  parseEnvBoolean,
  parseEnvInteger,
  parseEnvTags,
  resolveEnvValues
};
