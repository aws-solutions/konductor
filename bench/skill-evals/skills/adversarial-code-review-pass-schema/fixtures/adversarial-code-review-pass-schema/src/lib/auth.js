'use strict';

function authorize(req, res, next) {
  if (!req.get('authorization')) return res.status(401).json({ code: 'UNAUTHORIZED' });
  return next();
}

module.exports = { authorize };
