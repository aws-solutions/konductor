'use strict';

/**
 * `n` synthetic contacts, the same for the same `seed`. About one in five repeats an earlier email with other case or
 * spaces around it, as the import sees in real files.
 */
function makeContacts(n, seed = 1) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i > 10 && rnd() < 0.2) {
      const src = out[Math.floor(rnd() * out.length)];
      const email = rnd() < 0.5 ? ` ${src.email.toUpperCase()}` : `${src.email} `;
      out.push({ id: i, name: src.name, email });
    } else {
      out.push({ id: i, name: `Person ${i}`, email: `person${i}.${Math.floor(rnd() * 1e6)}@example.com` });
    }
  }
  return out;
}

module.exports = { makeContacts };
