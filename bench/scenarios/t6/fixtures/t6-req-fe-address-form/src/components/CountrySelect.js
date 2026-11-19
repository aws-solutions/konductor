'use strict';

const { countries } = require('../validation/countries');

function countryOptions() {
  return countries.map(({ code, name }) => ({ value: code, label: name }));
}

module.exports = { countryOptions };
