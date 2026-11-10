'use strict';

const { verifySession } = require('../session');

// All authenticated routes must be mounted behind this middleware.
async function requireAuth(req, res, next) {
  const session = await verifySession(req.get('authorization'));
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  req.session = session;
  return next();
}

module.exports = { requireAuth };
