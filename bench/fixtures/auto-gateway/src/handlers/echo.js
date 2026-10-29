'use strict';

module.exports = function echo(req) {
  return { said: req.query.text ?? '' };
};
