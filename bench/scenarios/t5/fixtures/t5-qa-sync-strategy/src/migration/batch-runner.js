const { mapCustomer } = require('../mapping/field-mapper');

async function migrateBatches({ source, target, checkpoints, batchSize, crashAfterCheckpoint = false }) {
  const checkpoint = await checkpoints.read();
  let page = await source.page(checkpoint.lastId, batchSize);
  let copied = checkpoint.count;
  while (page.length > 0) {
    const mapped = page.map(mapCustomer);
    const lastId = page[page.length - 1].id;
    await checkpoints.write({ lastId, count: copied + mapped.length });
    if (crashAfterCheckpoint) throw new Error('simulated interruption');
    for (const row of mapped) await target.upsert(row);
    copied += mapped.length;
    page = await source.page(lastId, batchSize);
  }
  return { copied };
}

module.exports = { migrateBatches };
