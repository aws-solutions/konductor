const http = require('node:http');
const { listProducts } = require('./http/products-route');

function createApp() {
  return http.createServer(async (req, res) => {
    if (req.url.startsWith('/v1/products')) return listProducts(req, res);
    res.writeHead(404, {'content-type': 'application/json'});
    res.end(JSON.stringify({error: 'not_found'}));
  });
}
module.exports = { createApp };
