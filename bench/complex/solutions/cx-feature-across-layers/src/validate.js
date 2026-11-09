'use strict';

const { UsageError } = require('./errors');

const MAX_TEXT = 280;
const MAX_TAGS = 5;
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,19}$/;

function validateText(text) {
  if (typeof text !== 'string' || text.trim().length === 0 || text.trim().length > MAX_TEXT) {
    throw new UsageError(`note text must be 1 to ${MAX_TEXT} characters`);
  }
  return text.trim();
}

function normalizeTag(raw) {
  const tag = String(raw).trim().toLowerCase();
  if (!TAG_PATTERN.test(tag)) throw new UsageError(`invalid tag "${raw}"`);
  return tag;
}

function checkTagCount(tags) {
  if (tags.length > MAX_TAGS) throw new UsageError(`a note can have at most ${MAX_TAGS} tags`);
}

function normalizeTags(raws) {
  const tags = [...new Set(raws.map(normalizeTag))];
  checkTagCount(tags);
  return tags;
}

module.exports = { validateText, normalizeTag, normalizeTags, checkTagCount, MAX_TEXT, MAX_TAGS };
