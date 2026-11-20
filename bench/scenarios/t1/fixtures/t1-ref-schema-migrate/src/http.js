const service = require('./customer-service');
const repository = require('./customer-repository');

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

async function handle(request, response, db) {
  const parts = request.url.split('?')[0].split('/').filter(Boolean);
  if (request.method === 'GET' && parts[0] === 'customers' && !parts[1]) return json(response, 200, repository.listCustomers(db));
  if (request.method === 'GET' && parts[0] === 'customers' && parts[1]) {
    const customer = service.findCustomer(db, Number(parts[1]));
    return customer ? json(response, 200, customer) : json(response, 404, { error: 'not found' });
  }
  if (request.method === 'POST' && parts[0] === 'customers') {
    let body = '';
    for await (const chunk of request) body += chunk;
    try { return json(response, 201, service.registerCustomer(db, JSON.parse(body))); }
    catch (error) { return json(response, 400, { error: error.message }); }
  }
  return json(response, 404, { error: 'not found' });
}

module.exports = { handle };
