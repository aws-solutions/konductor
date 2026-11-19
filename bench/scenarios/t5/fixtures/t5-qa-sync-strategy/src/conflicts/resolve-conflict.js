function resolveConflict(current, incoming) {
  if (!current) return incoming;
  if (new Date(incoming.updatedAt) >= new Date(current.updatedAt)) return incoming;
  return current;
}

module.exports = { resolveConflict };
