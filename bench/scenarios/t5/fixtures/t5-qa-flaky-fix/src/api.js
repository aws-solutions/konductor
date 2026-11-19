function createApi(service) {
  return {
    create(payload, random) {
      return service.add(payload, random);
    },
    remove(id) {
      if (!service.remove(id)) {
        const error = new Error('job not found');
        error.code = 'NOT_FOUND';
        throw error;
      }
      return { removed: id };
    },
    jobs() {
      return service.list();
    },
    async run(now) {
      return service.runDue(now);
    }
  };
}

module.exports = { createApi };
