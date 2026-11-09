'use strict';

const { NotFoundError } = require('./errors');
const { validateText } = require('./validate');

function createNotes(store) {
  return {
    add(text) {
      const clean = validateText(text);
      const data = store.load();
      const note = { id: data.nextId, text: clean, createdAt: new Date().toISOString() };
      data.notes.push(note);
      data.nextId += 1;
      store.save(data);
      return note;
    },

    list() {
      return store.load().notes;
    },

    remove(id) {
      const data = store.load();
      const index = data.notes.findIndex((n) => n.id === id);
      if (index === -1) throw new NotFoundError(`no note with id ${id}`);
      data.notes.splice(index, 1);
      store.save(data);
    },
  };
}

module.exports = { createNotes };
