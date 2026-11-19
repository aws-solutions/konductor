function makePlan({ sourceCount, batchSize }) {
  const batches = Math.ceil(sourceCount / batchSize);
  return { sourceCount, batchSize, batches, estimatedMinutes: Math.max(1, Math.ceil(batches / 20)) };
}

module.exports = { makePlan };
