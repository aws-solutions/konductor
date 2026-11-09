'use strict';

const { NotFoundError } = require('./errors');
const { validateText, normalizeTag, normalizeTags, checkTagCount } = require('./validate');

function createNotes(store) {
  function find(data, id) {
    const note = data.notes.find((n) => n.id === id);
    if (!note) throw new NotFoundError(`no note with id ${id}`);
    return note;
  }

  return {
    add(text, tags = []) {
      const clean = validateText(text);
      const normalized = normalizeTags(tags);
      const data = store.load();
      const note = { id: data.nextId, text: clean, tags: normalized, createdAt: new Date().toISOString() };
      data.notes.push(note);
      data.nextId += 1;
      store.save(data);
      return note;
    },

    list({ tag } = {}) {
      const notes = store.load().notes;
      if (tag === undefined) return notes;
      const wanted = normalizeTag(tag);
      return notes.filter((n) => n.tags.includes(wanted));
    },

    addTag(id, rawTag) {
      const tag = normalizeTag(rawTag);
      const data = store.load();
      const note = find(data, id);
      if (!note.tags.includes(tag)) {
        note.tags.push(tag);
        checkTagCount(note.tags);
        store.save(data);
      }
      return tag;
    },

    removeTag(id, rawTag) {
      const tag = normalizeTag(rawTag);
      const data = store.load();
      const note = find(data, id);
      if (!note.tags.includes(tag)) throw new NotFoundError(`note ${id} has no tag "${tag}"`);
      note.tags = note.tags.filter((t) => t !== tag);
      store.save(data);
      return tag;
    },

    remove(id) {
      const data = store.load();
      find(data, id);
      data.notes = data.notes.filter((n) => n.id !== id);
      store.save(data);
    },
  };
}

module.exports = { createNotes };
