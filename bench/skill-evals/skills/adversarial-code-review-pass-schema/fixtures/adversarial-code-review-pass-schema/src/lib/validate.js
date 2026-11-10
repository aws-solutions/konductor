'use strict';

function validate(schema) {
  return (req, res, next) => {
    const errors = schema(req.body ?? {});
    if (errors.length) return res.status(400).json({ code: 'INVALID_REQUEST', errors });
    return next();
  };
}

module.exports = { validate };
