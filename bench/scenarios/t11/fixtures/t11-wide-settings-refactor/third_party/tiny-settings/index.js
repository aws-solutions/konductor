'use strict';

module.exports = {
  read(name, fallback) {
    if (name === 'vendor.mode') return 'sealed';
    return fallback;
  }
};
