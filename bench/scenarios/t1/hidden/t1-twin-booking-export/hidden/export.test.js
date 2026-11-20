const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

function withServer(run, options = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(createApp(options));
    server.listen(0, '127.0.0.1', async () => {
      try {
        const result = await run(server.address().port);
        server.close();
        resolve(result);
      } catch (e) {
        server.close();
        reject(e);
      }
    });
  });
}

function request(port, method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path, headers }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(text), text });
        } else {
          resolve({ status: res.statusCode, headers: res.headers, text });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const options = { config: { serviceName: 'booking-api', logLevel: 'silent', seedFile: 'data/seed.json' } };

test('GET /api/v1/bookings/export returns CSV with header row', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/api/v1/bookings/export');
    assert.equal(result.status, 200);
    assert.equal(result.headers['content-type'], 'text/csv; charset=utf-8');
    const lines = result.text.split('\r\n');
    assert.equal(lines[0], 'id,room,date,owner');
  }, options);
});

test('CSV escapes values containing commas', async () => {
  // Use a custom seed file with a comma in the room name
  const customOptions = { config: { serviceName: 'booking-api', logLevel: 'silent', seedFile: 'hidden/data/seed-with-comma.json' } };
  await withServer(async port => {
    const result = await request(port, 'GET', '/api/v1/bookings/export');
    assert.equal(result.status, 200);
    const lines = result.text.split('\r\n');
    const commaLine = lines.find(l => l.includes('A, B'));
    assert.ok(commaLine, 'should find room with comma in output');
    // The value should be quoted because it contains a comma
    assert.match(commaLine, /"A, B"/);
  }, customOptions);
});

test('CSV escapes values containing double quotes', async () => {
  const customOptions = { config: { serviceName: 'booking-api', logLevel: 'silent', seedFile: 'hidden/data/seed-with-quotes.json' } };
  await withServer(async port => {
    const result = await request(port, 'GET', '/api/v1/bookings/export');
    assert.equal(result.status, 200);
    // Input: O"Brien (one double quote in the name)
    // Output: "O""Brien" (field is quoted, quote inside is doubled)
    assert.ok(result.text.includes('"O""Brien"'), 'double quote should be escaped as ""');
  }, customOptions);
});

test('CSV escapes values containing newlines (LF)', async () => {
  const customOptions = { config: { serviceName: 'booking-api', logLevel: 'silent', seedFile: 'hidden/data/seed-with-lf.json' } };
  await withServer(async port => {
    const result = await request(port, 'GET', '/api/v1/bookings/export');
    assert.equal(result.status, 200);
    // Field with LF must be quoted, and LF inside quotes stays as LF
    assert.ok(result.text.includes('"Line1\nLine2"'), 'LF should be in quoted field');
  }, customOptions);
});

test('CSV escapes values containing CRLF', async () => {
  const customOptions = { config: { serviceName: 'booking-api', logLevel: 'silent', seedFile: 'hidden/data/seed-with-crlf.json' } };
  await withServer(async port => {
    const result = await request(port, 'GET', '/api/v1/bookings/export');
    assert.equal(result.status, 200);
    // CRLF in field must be in quoted field
    assert.ok(result.text.includes('"Line1\r\nLine2"'), 'CRLF should be in quoted field');
  }, customOptions);
});

test('CSV has correct column order: id,room,date,owner', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/api/v1/bookings/export');
    assert.equal(result.status, 200);
    const lines = result.text.split('\r\n');
    assert.equal(lines[0], 'id,room,date,owner');
    const dataLine = lines[1];
    const parts = dataLine.split(',');
    assert.equal(parts[0], 'b-100');
    assert.equal(parts[1], 'Atlas');
    assert.equal(parts[2], '2025-06-20');
    assert.equal(parts[3], 'Operations');
  }, options);
});

test('from query parameter filters bookings by start date (inclusive)', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/api/v1/bookings/export?from=2025-06-21');
    assert.equal(result.status, 200);
    const lines = result.text.split('\r\n').filter(l => l);
    assert.equal(lines.length, 2);
    assert.ok(lines[1].includes('b-101'));
    assert.ok(!lines[1].includes('b-100'));
  }, options);
});

test('to query parameter filters bookings by end date (inclusive)', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/api/v1/bookings/export?to=2025-06-20');
    assert.equal(result.status, 200);
    const lines = result.text.split('\r\n').filter(l => l);
    assert.equal(lines.length, 2);
    assert.ok(lines[1].includes('b-100'));
    assert.ok(!lines[1].includes('b-101'));
  }, options);
});

test('both from and to query parameters work together (inclusive bounds)', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/api/v1/bookings/export?from=2025-06-20&to=2025-06-20');
    assert.equal(result.status, 200);
    const lines = result.text.split('\r\n').filter(l => l);
    assert.equal(lines.length, 2);
    assert.ok(lines[1].includes('b-100'));
  }, options);
});

test('invalid from date returns 400 JSON error', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/api/v1/bookings/export?from=invalid');
    assert.equal(result.status, 400);
    assert.ok(result.headers['content-type'].includes('application/json'));
    assert.equal(result.body.error.code, 'bad_request');
  }, options);
});

test('invalid to date returns 400 JSON error', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/api/v1/bookings/export?to=2025-13-01');
    assert.equal(result.status, 400);
    assert.ok(result.headers['content-type'].includes('application/json'));
    assert.equal(result.body.error.code, 'bad_request');
  }, options);
});

test('existing /bookings endpoint still works', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/bookings');
    assert.equal(result.status, 200);
    assert.equal(result.body.bookings.length, 2);
  }, options);
});

test('non-ISO date format is rejected', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/api/v1/bookings/export?from=06-20-2025');
    assert.equal(result.status, 400);
    assert.ok(result.headers['content-type'].includes('application/json'));
  }, options);
});

test('impossible calendar date is rejected', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/api/v1/bookings/export?from=2025-02-30');
    assert.equal(result.status, 400);
    assert.ok(result.headers['content-type'].includes('application/json'));
    assert.equal(result.body.error.code, 'bad_request');
  }, options);
});