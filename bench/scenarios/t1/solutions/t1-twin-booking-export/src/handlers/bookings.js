const { HttpError } = require('../errors');

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCSV(bookings) {
  const header = 'id,room,date,owner';
  const rows = bookings.map(b => [escapeCSV(b.id), escapeCSV(b.room), escapeCSV(b.date), escapeCSV(b.owner)].join(','));
  return [header, ...rows].join('\r\n');
}

function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str + 'T00:00:00');
  // Check for invalid dates (e.g., Feb 30) and that parsing didn't roll to next month
  const [year, month, day] = str.split('-').map(Number);
  return d instanceof Date && !isNaN(d) &&
         d.getFullYear() === year &&
         d.getMonth() + 1 === month &&
         d.getDate() === day;
}

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
    },
    export(request, response) {
      const url = new URL(request.url, 'http://localhost');
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');

      if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
        response.statusCode = 400;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ error: { code: 'bad_request', message: 'Invalid date format. Use ISO format (YYYY-MM-DD).' } }));
        return;
      }

      const bookings = service.exportBookings(from, to);
      const csv = toCSV(bookings);
      response.statusCode = 200;
      response.setHeader('content-type', 'text/csv; charset=utf-8');
      response.end(csv);
    }
  };
}

module.exports = { bookings };