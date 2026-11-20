'use strict';

function summarize(entries) {
  const result = new Map();
  for (const entry of entries) {
    const key = entry.project || 'unassigned';
    result.set(key, (result.get(key) || 0) + Number(entry.minutes || 0));
  }
  return [...result].map(([project, minutes]) => ({ project, minutes }));
}

module.exports = { summarize };
