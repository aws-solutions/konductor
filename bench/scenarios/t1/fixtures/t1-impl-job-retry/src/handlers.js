async function handleInventory(job, logger) {
  logger.debug('inventory sync', { jobId: job.id, warehouse: job.payload.warehouse });
  return { synced: true };
}

async function handleShipment(job, logger) {
  logger.debug('shipment created', { jobId: job.id, orderId: job.payload.orderId });
  return { accepted: true };
}

function createHandlers(logger) {
  return {
    'inventory.sync': job => handleInventory(job, logger),
    'shipment.create': job => handleShipment(job, logger)
  };
}

module.exports = { createHandlers, handleInventory, handleShipment };
