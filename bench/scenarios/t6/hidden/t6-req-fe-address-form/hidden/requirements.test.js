const test = require('node:test');
const assert = require('node:assert/strict');
const { scriptedSuite } = require('./doc-key');

scriptedSuite(test, assert, {
  doc: 'docs/requirements.md',
  facts: [
    {
      id: 'F1',
      all: [/United States|\bUS\b|\bUSA\b/i, /Canada|\bCA\b/i, /United Kingdom|\bUK\b|\bGB\b/i, /(?:only|limited to|exclud|defer).*(?:launch|first release|release 1|initial release)|(?:launch|first release|initial release).*(?:only|limited to)/i],
      wrong: [/Australia\s+(?:is\s+)?(?:supported|included|available)/i]
    },
    {
      id: 'F2',
      all: [/(?:five|5)[- ]digits?|\\d\{5\}|\b\d{5}\b/i, /(?:four|4)[- ]digits?|ZIP\s*\+\s*4|\\d\{4\}|\b\d{5}-\d{4}\b/i, /A1A ?1A1|letter[- ]digit[- ]letter|\[A-Z\]\\d\[A-Z\]/i, /outward|inward/i],
      wrong: [/US.*(?:six|6)\s*digits/i, /Canada.*(?:without|no)\s+space/i]
    },
    {
      id: 'F3',
      all: [/ParcelPin Lookup v2/i, /\b3\b|\bthree\b/i, /lookups?|requests?/i, /manual(?:ly)? (?:entry|enter|address)|enter (?:it|the address|the full address) manually/i],
      wrong: [/ParcelPin Lookup v2.*(?:5|five)/i]
    },
    {
      id: 'F4',
      all: [/WCAG 2\.2 AA/i, /error summary/i, /focus/i],
      wrong: [/WCAG 2\.1/i]
    },
    {
      id: 'F5',
      all: [/checkout_address_viewed/i, /checkout_address_submitted/i, /checkout_address_lookup_used/i, /payload[^.]*(?:unchanged|as (?:they are|today)|same)|(?:unchanged|same)[^.]*payload/i, /\bonce\b/i],
      wrong: [/checkout_address_viewed.*(?:rename|replace)/i]
    },
    {
      id: 'F6',
      all: [/360\s*(?:px|pixels?)|360[- ]pixel/i, /horizontal scroll/i, /48\s*(?:px|pixels?)|48[- ]pixel/i, /control|target|button|tap/i],
      wrong: [/320\s*(?:px|pixel)/i]
    },
    {
      id: 'F7',
      all: [/P\.?O\.? box/i, /United States|\bUS\b|\bUSA\b/i, /Canada|\bCA\b/i, /reject|not (?:be )?allow|disallow|block|refuse|not permitted/i, /United Kingdom|\bUK\b|\bGB\b/i, /street address/i],
      wrong: [/PO boxes?.*(?:United Kingdom|UK).*allow/i]
    },
    {
      id: 'F8',
      all: [/autocomplete|autofill/i, /address-line1|postal-code|country/i, /(?:unit|apartment)[^.]*manual|manual[^.]*(?:unit|apartment)/i],
      wrong: [/autocomplete.*street-address/i]
    }
  ],
  ground: [
    'src/validation/address.js',
    'src/validation/postcode.js',
    'src/validation/countries.js',
    'analytics/events.json',
    'docs/checkout-flow.md',
    'docs/design-notes.md',
    'policy/privacy-and-logging.md',
    'data/address-validation-export.csv',
    'data/lookup-usage.csv',
    'data/mobile-field-errors.csv',
    'support/address-complaints.csv'
  ],
  minRequirements: 5
});
