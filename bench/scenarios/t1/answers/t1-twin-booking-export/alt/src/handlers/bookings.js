const { URL } = require('node:url');
const { HttpError } = require('../errors');
const { isStrictISODate } = require('../utils/validation');

function exportRange(request) {
  const params = new URL(request.url, 'http://localhost').searchParams;
  const range = {};
  for (const name of ['from', 'to']) {
    const values = params.getAll(name);
    if (values.length === 0) continue;
    if (values.length !== 1 || !isStrictISODate(values[0])) {
      throw new HttpError(400, 'bad_request', `${name} must use YYYY-MM-DD`);
    }
    range[name] = values[0];
  }
  return range;
}

function csvField(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function bookings(service) {
  return {
    list(_request, response) {
      response.json(200, { bookings: service.list() });
    },
    exportCsv(request, response) {
      const rows = service.list(exportRange(request));
      const lines = [
        ['id', 'room', 'date', 'owner'].join(','),
        ...rows.map(booking => [booking.id, booking.room, booking.date, booking.owner].map(csvField).join(','))
      ];
      response.statusCode = 200;
      response.setHeader('content-type', 'text/csv; charset=utf-8');
      response.end(`${lines.join('\r\n')}\r\n`);
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

module.exports = { bookings, csvField, exportRange };
