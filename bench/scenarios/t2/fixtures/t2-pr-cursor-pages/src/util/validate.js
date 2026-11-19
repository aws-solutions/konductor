'use strict';

const { badRequest } = require('../errors');

function requiredText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest(`${name} is required`);
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

module.exports = { requiredText, optionalText };
