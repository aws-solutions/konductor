'use strict';

const tones = Object.freeze({
  coral: '#d86d5c',
  violet: '#7c68b2',
  slate: '#697582',
  plain: '#b5a98f',
  muted: '#9b9b9b'
});

function colorForTone(tone) {
  return tones[tone] || tones.muted;
}

module.exports = { tones, colorForTone };
