function health(_request, response) {
  response.json(200, { status: 'ok', service: response.serviceName });
}

function ready(_request, response) {
  response.json(200, { ready: true });
}

module.exports = { health, ready };
