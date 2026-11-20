'use strict';
function money(cents) { return (cents / 100).toFixed(2); }
function summary(ret) { return ret.id + ' ' + money(ret.amountCents) + ' ' + ret.state; }
module.exports = { money, summary };
