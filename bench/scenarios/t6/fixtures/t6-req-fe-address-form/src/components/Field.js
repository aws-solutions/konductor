'use strict';

function fieldModel(name, label, value = '') {
  return { name, label, value, describedBy: `${name}-hint ${name}-error` };
}

module.exports = { fieldModel };
