const { CheckoutError } = require('../errors');

async function reserve(repository, lines, pause = async () => {}) {
  const available = {};
  for (const line of lines) {
    available[line.sku] = await repository.get(line.sku);
    if (available[line.sku] < line.quantity) {
      throw new CheckoutError(`Not enough ${line.sku}`, 'OUT_OF_STOCK', { sku: line.sku });
    }
  }

  await pause();
  for (const line of lines) {
    await repository.set(line.sku, available[line.sku] - line.quantity);
  }
  return { status: 'reserved', lines };
}

module.exports = { reserve };
