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
      all: [/group/i, /\b3\b|\bthree\b/i, /minimum|at least|or more|fewer than|smaller than|below/i],
      wrong: [/minimum\s+group[^.]{0,20}\b(?:2|4|two|four)\b/i]
    },
    { 
      id: 'F4', 
      all: [/emergenc/i, /exception|discretion|waive|override/i, /coordinator/i, /\b24[- ]?h(?:ours?|rs?)?\b|twenty-four hours/i, /cancel|notice/i],
      wrong: [/no\s+exception/i, /strict.*24\s+hours/i, /never.*cancel/i]
    },
    { 
      id: 'F5', 
      all: [/(?:verify|verif\w*|check)\s+(?:the\s+)?age|age\s+(?:verification|check)|age[^.]{0,40}verif|verif\w*[^.]{0,40}\bage\b/i, /without\s+storing|not\s+(?:be\s+)?stor|no\s+(?:full\s+)?(?:birth|dob)|instead of (?:a |the )?(?:full )?birth/i, /age\s+(?:bracket|band|range|group)|16-17|18\+/i],
      wrong: [/store.*birth.*date/i, /require.*date\s+of\s+birth/i, /dob.*required/i]
    },
    { 
      id: 'F6', 
      all: [/coordinator/i, /\bage\b|medical|background/i, /cannot|can't|must not|should not|shall not|not (be )?(able to )?(see|view|visible|shown)|unable to|hidden|restrict|no access|exclude/i],
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