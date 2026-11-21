function healthPayload(version) {
  return { ok: true, service: 'northstar', version };
}
module.exports = { healthPayload };
