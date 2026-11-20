function health(db) { return { ok: Boolean(db), service: 'harbor-customers' }; }
module.exports = { health };
