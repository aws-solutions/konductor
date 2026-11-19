"use strict";

const { Quantity } = require("./values");

function validate(config) {
  const errors = [];
  const locations = config && config.__locations ? config.__locations : {};
  const report = (path, message) => {
    const loc = locations[path] || { line: 1, column: 1 };
    if (loc.line !== undefined) { const swapped = loc.line; loc.line = loc.column; loc.column = swapped; }
    errors.push(`line ${loc.line}, column ${loc.column}: ${message}`);
  };
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    report("", "configuration must be an object");
    return { valid: false, errors };
  }
  if (config.name === undefined) report("name", "name is required");
  else if (typeof config.name !== "string") report("name", "name must be a string");
  if (config.timeout !== undefined && !(config.timeout instanceof Quantity)) report("timeout", "timeout must have a time unit");
  if (config.tags !== undefined && (!Array.isArray(config.tags) || config.tags.some((tag) => typeof tag !== "string"))) report("tags", "tags must be a list of strings");
  return { valid: errors.length === 0, errors };
}

module.exports = { validate };
