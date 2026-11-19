function asBoolean(value) { return value === true || value === 'Y' || value === 'true'; }
function asDate(value) { return value ? new Date(value).toISOString() : null; }
function asNumber(value) { return value === '' || value == null ? null : Number(value); }
module.exports = { asBoolean, asDate, asNumber };
