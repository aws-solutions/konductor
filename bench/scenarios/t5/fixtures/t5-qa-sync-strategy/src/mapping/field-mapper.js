const { asBoolean, asDate, asNumber } = require('./type-converters');

function mapCustomer(source) {
  return {
    id: String(source.id),
    email: String(source.email || '').trim().toLowerCase(),
    displayName: String(source.full_name || '').slice(0, 80),
    creditLimit: asNumber(source.credit_limit) || 0,
    subscribed: asBoolean(source.subscribed),
    joinedAt: asDate(source.joined_at),
    postalCode: String(source.postal_code || '').slice(0, 12)
  };
}

module.exports = { mapCustomer };
