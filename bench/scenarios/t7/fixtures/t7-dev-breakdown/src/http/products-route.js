const { getProducts } = require('../services/catalog-service');

async function listProducts(_req, res) {
  try {
    const products = await getProducts();
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({ data: products }));
  } catch (err) {
    res.writeHead(500, {'content-type': 'application/json'});
    res.end(JSON.stringify({ error: err.code || 'internal_error' }));
  }
}
module.exports = { listProducts };
