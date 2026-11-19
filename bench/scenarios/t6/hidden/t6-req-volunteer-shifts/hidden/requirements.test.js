const test = require('node:test');
const assert = require('node:assert/strict');
const { scriptedSuite } = require('./doc-key');

scriptedSuite(test, assert, { 
  doc: 'docs/requirements.md', 
  facts: [
    { 
      id: 'F1', 
      all: [/mountain/i, /time|display|shown/i],
      wrong: [/convert[^.]{0,30}(each|volunteer'?s?)[^.]{0,20}time\s*zone/i]
    },
    { 
      id: 'F2', 
      all: [/background\s+check.*5.*7/i, /5.*7.*business\s+days/i],
      wrong: [/background\s+check.*instant/i, /background\s+check.*24.*hour/i, /\b3\s+days.*background/i]
    },
    { 
      id: 'F3', 
      all: [/minimum.*group.*3/i],
      wrong: [/minimum.*group.*2/i, /minimum.*group.*4/i, /individual.*sign.*up/i]
    },
    { 
      id: 'F4', 
      all: [/emergency.*exception.*coordinator.*discretion/i, /24.*hour.*notice.*emergency/i],
      wrong: [/no\s+exception/i, /strict.*24\s+hours/i, /never.*cancel/i]
    },
    { 
      id: 'F5', 
      all: [/age\s+verification.*without.*birth.*date/i, /age\s+bracket/i],
      wrong: [/store.*birth.*date/i, /require.*date\s+of\s+birth/i, /dob.*required/i]
    },
    { 
      id: 'F6', 
      all: [/coordinator/i, /\bage\b|medical|background/i, /cannot|can't|must not|not (be )?(see|visible|shown)|hidden|restrict|no access|exclude/i],
      wrong: [/coordinators?\s+(can|may)\s+see\s+(the\s+)?(volunteer'?s?\s+)?(full\s+)?(age|birth)/i]
    }
  ], 
  ground: [
    'data/volunteer-shifts-2024.csv',
    'data/sites.csv', 
    'data/volunteer-demographics.csv',
    'policy/safeguarding-policy.md',
    'policy/volunteer-handbook-excerpt.md'
  ] 
});