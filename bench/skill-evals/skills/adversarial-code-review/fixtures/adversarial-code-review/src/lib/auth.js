'use strict';

function authorize(req, res, next) {
  const token = req.get('authorization');
  if (!token || !req.app.locals.verifyToken(token)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  req.principal = req.app.locals.verifyToken(token);
  return next();
}

module.exports = { authorize };
