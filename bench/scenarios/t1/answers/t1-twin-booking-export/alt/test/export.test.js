const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { withServer } = require('./helpers');

function requestText(port, path) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, method: 'GET', path }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    request.on('error', reject);
    request.end();
  });
}

function store(rows) {
  return {
    all: () => rows.map(row => ({ ...row })),
    get: id => rows.find(row => row.id === id) || null,
    insert: row => (rows.push({ ...row }), row),
    remove: id => false
  };
}

const config = { serviceName: 'booking-api', logLevel: 'silent', seedFile: 'data/seed.json' };

test('booking export writes RFC 4180 CSV and applies inclusive date bounds', async () => {
  const data = [
    { id: 'b-1', room: 'Oak, West', date: '2025-06-20', owner: 'A "quoted"\nTeam' },
    { id: 'b-2', room: 'Cedar', date: '2025-06-21', owner: 'Finance' },
    { id: 'b-3', room: 'Elm', date: '2025-06-22', owner: 'Operations' }
  ];
  await withServer(async port => {
    const result = await requestText(port, '/api/v1/bookings/export?from=2025-06-20&to=2025-06-21');
    assert.equal(result.status, 200);
    assert.equal(result.headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal(result.text, 'id,room,date,owner\r\nb-1,"Oak, West",2025-06-20,"A ""quoted""\nTeam"\r\nb-2,Cedar,2025-06-21,Finance\r\n');
  }, { config, store: store(data) });
});

test('booking export rejects malformed or impossible date bounds', async () => {
  for (const value of ['06-20-2025', '2025-02-30', '2025-06-2']) {
    await withServer(async port => {
      const result = await requestText(port, `/api/v1/bookings/export?from=${value}`);
      assert.equal(result.status, 400);
      assert.deepEqual(JSON.parse(result.text).error.code, 'bad_request');
    }, { config, store: store([]) });
  }
});
