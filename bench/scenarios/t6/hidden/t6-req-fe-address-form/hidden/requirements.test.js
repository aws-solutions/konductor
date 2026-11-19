const test = require('node:test');
const assert = require('node:assert/strict');
const { scriptedSuite } = require('./doc-key');

scriptedSuite(test, assert, {
  doc: 'docs/requirements.md',
  facts: [
    {
      id: 'F1',
      all: [/United States.*Canada.*United Kingdom/i, /(?:only|limited to|exclude).*launch|launch.*(?:only|limited to)/i],
      wrong: [/Australia\s+(?:is\s+)?(?:supported|included|available)/i]
    },
    {
      id: 'F2',
      all: [/five digits.*(?:four digits|ZIP\+?4)|5 digits.*4 digits/i, /Canada.*A1A 1A1/i, /UK.*outward.*inward/i],
      wrong: [/US.*(?:six|6)\s*digits/i, /Canada.*(?:without|no)\s+space/i]
    },
    {
      id: 'F3',
      all: [/ParcelPin Lookup v2/i, /(?:at most|maximum|max|up to)\s*3.*(?:lookup|request)/i, /manual entry/i],
      wrong: [/ParcelPin Lookup v2.*(?:5|five)/i]
    },
    {
      id: 'F4',
      all: [/WCAG 2\.2 AA/i, /(?:error summary.*focus|focus.*error summary)/i],
      wrong: [/WCAG 2\.1/i]
    },
    {
      id: 'F5',
      all: [/checkout_address_viewed.*checkout_address_submitted.*checkout_address_lookup_used/i, /payload (?:keys|fields).*unchanged/i, /each.*once/i],
      wrong: [/checkout_address_viewed.*(?:rename|replace)/i]
    },
    {
      id: 'F6',
      all: [/360\s*(?:px|pixel).*(?:no horizontal|without horizontal)/i, /48\s*(?:px|pixel).*(?:control|target)|(?:control|target).*48\s*(?:px|pixel)/i],
      wrong: [/320\s*(?:px|pixel)/i]
    },
    {
      id: 'F7',
      all: [/PO boxes?.*(?:United States|US).*(?:Canada|CA)/i, /(?:reject|not allow|disallow).*(?:United Kingdom|UK).*street address/i],
      wrong: [/PO boxes?.*(?:United Kingdom|UK).*allow/i]
    },
    {
      id: 'F8',
      all: [/(?:autocomplete|autofill).*(?:address-line1|postal-code|country)/i, /(?:unit|apartment).*manual|manual.*(?:unit|apartment)/i],
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
  minRequirements: 5,
  maxQuestions: 6
});
