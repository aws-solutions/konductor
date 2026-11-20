'use strict';

const { parseWeight } = require('./weight.js');
const { deliveryDate } = require('./eta.js');
const { priceFor } = require('./price.js');
const { labelText } = require('./label.js');

/** A quote for the counter: { kg, price, eta, label }. */
function quote({ weight, shipDate, service = 'standard' }) {
  const kg = parseWeight(weight);
  const eta = deliveryDate(shipDate, service);
  return { kg, price: priceFor(kg, service), eta, label: labelText({ kg, service, eta }) };
}

module.exports = { quote, parseWeight, deliveryDate, priceFor, labelText };
