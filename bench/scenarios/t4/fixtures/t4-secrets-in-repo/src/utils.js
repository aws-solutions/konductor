function normalizePhone(value) {
  const digits = String(value || '').replace(/[^0-9+]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
}

function limitMessage(value, max = 640) {
  return String(value).slice(0, max);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

module.exports = { normalizePhone, limitMessage, isPlainObject };
