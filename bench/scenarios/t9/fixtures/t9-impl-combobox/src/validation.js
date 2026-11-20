function isEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim()); }
function required(value) { return String(value ?? '').trim().length > 0; }
if (typeof module !== 'undefined') module.exports = { isEmail, required };
