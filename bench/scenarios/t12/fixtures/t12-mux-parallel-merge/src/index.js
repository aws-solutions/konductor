'use strict';

module.exports = {
  ...require('./catalog'),
  ...require('./inventory'),
  ...require('./pricing'),
  ...require('./report')
};
