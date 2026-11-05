'use strict';

function parse(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text).trim());
  if (!m) throw new Error(`not an ISO date: ${text}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

exports.parse = parse;
