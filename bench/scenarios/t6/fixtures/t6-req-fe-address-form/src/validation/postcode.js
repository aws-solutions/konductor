'use strict';

// The snapshot's checks are deliberately permissive; the redesign still needs an agreed product contract.
const patterns = {
  US: /^[\d -]{5,10}$/,
  CA: /^[A-Z\d ]{6,8}$/i,
  GB: /^[A-Z\d ]{5,9}$/i
};

function postcodeLooksValid(country, value) {
  const re = patterns[country];
  return !re || re.test(String(value).trim());
}

module.exports = { patterns, postcodeLooksValid };
