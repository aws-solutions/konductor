'use strict';

function profile(id = 'u-1') {
  return { id, name: 'Test User', email: `${id}@example.test`, team: 'qa' };
}

function permissions(id = 'u-1') {
  return { id, roles: ['reader'] };
}

module.exports = { profile, permissions };
