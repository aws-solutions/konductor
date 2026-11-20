'use strict';

const notes = [];

function list(owner) {
  return notes.filter((n) => n.owner === owner);
}

function add(owner, text) {
  const note = { id: notes.length + 1, owner, text };
  notes.push(note);
  return note;
}

module.exports = { list, add };
