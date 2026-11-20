'use strict';

const KNOWN_LABELS = new Set(['client', 'internal', 'planning', 'support']);

function tidyLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels.map(String).map(label => label.trim().toLowerCase()).filter(Boolean);
}

module.exports = { KNOWN_LABELS, tidyLabels };
