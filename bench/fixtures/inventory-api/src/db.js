'use strict';

const rows = [
  { id: '1', name: 'Widget', qty: 10, reorderLevel: 5 },
  { id: '2', name: 'Gadget', qty: 5, reorderLevel: 5 },
  { id: '3', name: 'Gizmo', qty: 2, reorderLevel: 5 },
];

// Stand-in for a SQL driver. It understands only the statement shapes the
// repository uses: `name LIKE` clauses (literal or `?` placeholder) joined by
// OR, and always-true comparisons such as '1'='1'.
async function query(sql, params = []) {
  const where = /WHERE (.*)$/i.exec(sql);
  if (!where) return rows.slice();
  let next = 0;
  const clauses = where[1].replace(/--.*$/, '').split(/ OR /i);
  const matchers = clauses.map((raw) => {
    const clause = raw.trim();
    const literal = /^name LIKE '%(.*)%'$/i.exec(clause);
    if (literal) {
      const term = literal[1].toLowerCase();
      return (r) => r.name.toLowerCase().includes(term);
    }
    if (/^name LIKE \?$/i.test(clause)) {
      const term = String(params[next++]).replace(/^%|%$/g, '').toLowerCase();
      return (r) => r.name.toLowerCase().includes(term);
    }
    const same = /^'([^']*)'\s*=\s*'([^']*)'$/.exec(clause);
    if (same) return () => same[1] === same[2];
    return () => false;
  });
  return rows.filter((r) => matchers.some((m) => m(r)));
}

module.exports = { rows, query };
