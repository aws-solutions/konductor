'use strict';

function validateCard(input) {
  const errors = {};
  if (!input || !String(input.title || '').trim()) errors.title = 'A title is required';
  if (input && input.title && String(input.title).trim().length > 120) errors.title = 'Use 120 characters or fewer';
  if (input && input.labels && (!Array.isArray(input.labels) || input.labels.some((label) => typeof label !== 'string'))) {
    errors.labels = 'Labels must be text values';
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

function isColumnId(id) {
  return id === 'inbox' || id === 'active' || id === 'done';
}

module.exports = { validateCard, isColumnId };
