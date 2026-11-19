'use strict';

const { notFound } = require('../errors');

function createUserHandlers(store) {
  return {
    list() {
      return store.listUsers().sort((a, b) => a.name.localeCompare(b.name));
    },
    get(id) {
      const user = store.findUser(id);
      if (!user) throw notFound('User not found');
      return user;
    },
  };
}

module.exports = { createUserHandlers };
