'use strict';

/** The text printed on the parcel label. */
function labelText({ kg, service, eta }) {
  return `PARCEL ${kg} kg | ${service} | due ${eta}`;
}

module.exports = { labelText };
