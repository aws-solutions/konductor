const path = require('node:path');

module.exports = {
  UPLOAD_DIR: path.resolve(__dirname, '..', 'uploads'),
  MAX_BYTES: 5 * 1024 * 1024,
};
