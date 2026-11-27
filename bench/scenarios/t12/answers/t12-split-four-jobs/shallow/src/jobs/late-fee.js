'use strict';

// See docs/jobs/late-fee.md. Shallow fake: a flat 2500 for every unpaid bill, no bands and no cap.
function run({ bills }) {
  const fees = bills.filter((b) => b.paid === null).map((b) => ({ accountId: b.accountId, feeCents: 2500 }));
  return { fees, totalCents: fees.length * 2500 };
}

module.exports = { run };
