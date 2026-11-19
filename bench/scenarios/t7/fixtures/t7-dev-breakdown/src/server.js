const { createApp } = require('./app');
const config = require('./config');

if (require.main === module) createApp().listen(config.port);
module.exports = { createApp };
