'use strict';

let nextId = 1;

function createId(prefix = 'notice') {
  return `${prefix}_${nextId++}`;
}

module.exports = { createId };
