function bookings(service) {
  return {
    list(_request, response) {
      response.json(200, { bookings: service.list() });
    },
    export(_request, response) {
      const rows = service.list();
      const csv = [
        'id,room,date,owner',
        ...rows.map(booking => [booking.id, booking.room, booking.date, booking.owner].join(','))
      ].join('\n');
      response.statusCode = 200;
      response.setHeader('content-type', 'text/csv');
      response.end(csv);
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
