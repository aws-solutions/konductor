'use strict';

// See docs/jobs/interest.md. apr is held as hundredths of a percent so the sum stays in integers.
function run(accounts) {
  const out = [];
  for (const a of accounts) {
    if (a.status === 'closed') continue;
    const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(a.apr));
    if (!m) throw new Error(`interest: account ${a.id} has a bad apr "${a.apr}"`);
    if (a.balanceCents <= 0) continue;
    const bps = BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
    const num = BigInt(a.balanceCents) * bps;
    const den = 100n * 100n * 12n;
    out.push({ id: a.id, interestCents: Number((num * 2n + den) / (den * 2n)) });
  }
  return out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

module.exports = { run };
