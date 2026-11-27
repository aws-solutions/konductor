'use strict';

// See docs/jobs/interest.md. Shallow fake: floating-point maths, no skips, no apr check, no sort.
function run(accounts) {
  return accounts.map((a) => ({ id: a.id, interestCents: Math.round((a.balanceCents * parseFloat(a.apr)) / 100 / 12) }));
}

module.exports = { run };
