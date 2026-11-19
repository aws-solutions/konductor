'use strict';

function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

if (require.main === module) console.log(formatCents(Number(process.argv[2] || 0)));
module.exports = { formatCents };
