"use strict";

const { parse } = require("./parser");
const { validate } = require("./validator");
const { print } = require("./printer");
const { ValidationError } = require("./errors");

function parseAndValidate(text) {
  const config = parse(text);
  const result = validate(config);
  if (!result.valid) throw new ValidationError(result.errors);
  return config;
}

module.exports = { parse, validate, parseAndValidate, print };
