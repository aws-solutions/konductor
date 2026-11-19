const { size } = require('./queue');
function health() { return { status: 'ok', queueDepth: size() }; }
module.exports = { health };
