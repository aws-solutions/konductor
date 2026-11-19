'use strict';

function healthPayload(version = '1.4.0') {
  return { ok: true, service: 'paper-lantern', version };
}

module.exports = { healthPayload };
