const { sendJson } = require('../utils/json');

function health(_req, res) {
  sendJson(res, 200, { status: 'ok', service: 'harbor-payments' });
}

module.exports = { health };
