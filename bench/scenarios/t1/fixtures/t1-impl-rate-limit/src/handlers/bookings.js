function bookings(service) {
  return {
    list(_request, response) {
      response.json(200, { bookings: service.list() });
    },
    get(request, response) {
      response.json(200, service.find(request.params.id));
    },
    create(request, response) {
      response.json(201, service.create(request.body));
    },
    remove(request, response) {
      service.remove(request.params.id);
      response.json(204, null);
    }
  };
}

module.exports = { bookings };
