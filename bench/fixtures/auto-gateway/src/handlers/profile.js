'use strict';

const { HttpError } = require('../errors');

module.exports = function profile(req) {
  if (!req.user) throw new HttpError(401, 'sign in first');
  return { user: req.user };
};
