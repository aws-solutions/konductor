function makeChange({ sequence, id, operation, changedAt, fields = {} }) {
  if (!Number.isInteger(sequence) || !id || !operation) throw new Error('invalid change');
  return { sequence, id, operation, changedAt, fields };
}

module.exports = { makeChange };
