function registerRoutes(router, handlers) {
  router.add('GET', '/health', handlers.health);
  router.add('GET', '/ready', handlers.ready);
  router.add('GET', '/bookings', handlers.list);
  router.add('POST', '/bookings', handlers.create);
  router.add('GET', '/bookings/:id', handlers.get);
  router.add('DELETE', '/bookings/:id', handlers.remove);
  router.add('GET', '/api/v1/bookings/export', handlers.export);
}

module.exports = { registerRoutes };