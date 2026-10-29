'use strict';

// Label formatter for the retired address-book printout. Not used.
function label(contact) {
  return `${contact.fullName.toUpperCase()} (${contact.email})`;
}

module.exports = { label };
