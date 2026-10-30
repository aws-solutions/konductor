// SPDX-License-Identifier: Apache-2.0
'use strict';

// Public-repo hygiene: markers that must not appear in files committed to the public repository.
// The patterns are built from parts so this file does not match itself.

const join = (...p) => p.join('');

const MARKERS = [
  { name: 'internal host', re: new RegExp(`${join('amaz', 'on')}\\.(?:com|dev)|${join('aws', '\\.dev')}|${join('corp', '\\.')}`, 'i') },
  { name: 'internal code host', re: new RegExp(`${join('code', '\\.amaz', 'on')}|${join('git', '\\.amaz', 'on')}`, 'i') },
  { name: 'internal tool', re: new RegExp(`\\b(?:${join('qu', 'ip')}|${join('bra', 'zil')}|${join('aim', '-build')}|${join('cr', 'ux')}|${join('mid', 'way')}|${join('isen', 'gard')}|${join('dev', '-dsk')})\\b`, 'i') },
  { name: 'internal id', re: /\bCR-\d+|\bTD-\d+/ },
  { name: 'internal name', re: new RegExp(`${join('as', 'dlc')}|${join('sol', 'nexus')}|${join('nih', 'itkas')}`, 'i') },
  { name: 'local path', re: new RegExp(`${join('/local', '/home')}|${join('/Us', 'ers/')}`) },
  { name: 'account id', re: /\b\d{12}\b/ },
  { name: 'credential', re: new RegExp(`${join('AK', 'IA')}[0-9A-Z]{16}|${join('aws_se', 'cret_access_key')}|BEGIN [A-Z ]*${join('PRIV', 'ATE KEY')}`, 'i') },
];

/** The first marker found in `text`, or null. */
function findMarker(text) {
  for (const m of MARKERS) {
    const hit = m.re.exec(text);
    if (hit) return { marker: m.name, sample: hit[0] };
  }
  return null;
}

module.exports = { findMarker, MARKERS };
