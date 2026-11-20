'use strict';
function freshLine(id = 'line-test', cents = 1200) { return { id, orderId: 'order-test', amountCents: cents }; }
module.exports = { freshLine };
