const test = require('node:test');
const assert = require('node:assert/strict');
const { scriptedSuite } = require('./doc-key');

// Two terms in the same clause, in either order (a requirement may say "12 items on a regular card" or "regular: 12").
const near = (a, b) => new RegExp(`(?:${a})[^.;]{0,60}?(?:${b})|(?:${b})[^.;]{0,60}?(?:${a})`, 'i');


scriptedSuite(test, assert, { 
  doc: 'docs/requirements.md', 
  facts: [
    {
      id: 'F1',
      all: [near('regular', '\\b12\\b|twelve'), near('student', '\\b15\\b|fifteen'), near('senior', '\\b10\\b|\\bten\\b'), near('child(?:ren)?', '\\b5\\b|\\bfive\\b'), near('institution', '\\b20\\b|twenty')],
      wrong: [/regular(?:\s+cards?)?\s*[:=(-]?\s*(?:of\s+|up to\s+|is\s+)?\b(15|20|25)\b/i, /student(?:\s+cards?)?\s*[:=(-]?\s*(?:of\s+|up to\s+|is\s+)?\b(10|5|20)\b/i]
    },
    {
      id: 'F2',
      all: [near('north\\s*hill', '\\b10[\\s-]*days?|\\bten[\\s-]*days?'), near('central', 'after[- ]hours|locker')],
      wrong: [/north\s*hill[^.;,\d]{0,25}\b(7|5|3)[\s-]*days?/i, /central[^.]{0,30}\bno\s+after[- ]hours/i]
    },
    {
      id: 'F3',
      all: [/parent/i, /notif/i, /default/i, /opt(?:s|ing|ed)?[- ]?out|turn(?:ed)? off|switch(?:ed)? off|disable|withdraw/i, /in[- ]person|at (?:the|a) branch|in the branch/i],
      wrong: [/parents?\s+(?:must|need to|have to|can)\s+opt[ -]?in\b|parent(?:al)?\s+notifications?\s+(?:are|is)\s+opt[ -]?in/i, /\bno\s+(?:separate\s+)?parent(?:al)?\s+notifications?/i]
    },
    {
      id: 'F4',
      all: [/\b24[- ]?h(?:ours?|rs?)?\b|twenty-four hours|one day/i, /check[- ]?out|borrow|claim/i, /(?:one|1|a single|single)\s+(?:automatic\s+)?renewal|renew(?:ed|s)?\s+(?:automatically\s+)?once/i],
      wrong: [/\b48[- ]?h(?:ours?|rs?)?\b[^.]{0,20}(?:checkout|check-out|to check out|window)/i, /\bno\s+(?:automatic\s+)?renewals?\b(?![^.]{0,40}(?:waiting|waitlist|queue|someone|another|other patron))/i]
    },
    {
      id: 'F5',
      all: [near('e-?mail', 'primary|first|main|default'), near('sms|text messages?', 'backup|fall ?back|secondary|second'), near('phone', 'senior')],
      wrong: [/\b(?:sms|text(?: messages?)?)\s+(?:is|as)\s+(?:the\s+)?primary/i, /e-?mail\s+(?:is\s+)?optional/i]
    },
    {
      id: 'F6',
      all: [/march\s*1(?:st)?\b|\b1(?:st)?\s+march|-03-01/i, /(?:existing|old|older|prior|earlier|outstanding|previous)\s+fines|fines\s+(?:from\s+|incurred\s+)?before/i, /\b60[\s-]*days?|sixty[\s-]*days?/i],
      wrong: [/\ball\s+(?:existing\s+|old\s+)?fines\s+(?:are\s+|will be\s+)?waived/i, /\bno\s+appeal/i]
    },
    {
      id: 'F7',
      all: [/wcag|accessib/i, /launch/i, /\b(?:6|six)[- ]?months?/i, /grace/i],
      wrong: [/\ball\s+features[^.]{0,30}wcag[^.]{0,30}launch/i, /\bno\s+grace\s+period\s+(?:for|on)\s+(?:the\s+)?(?:analytics|advanced)/i]
    },
    {
      id: 'F8',
      all: [near('bookmobile', 'phase\\s*(?:2|two|ii)\\b|second phase|later phase'), /august\s*(?:of\s*)?2024|2024-08/i, near('school\\s+delivery', 'exclud|out of scope|not included|not in scope|manual')],
      wrong: [/bookmobile[^.]{0,20}phase\s*(?:1|one|i)\b/i, /school\s+delivery\s+(?:is\s+|will be\s+)?included/i]
    }
  ],
  ground: [
    'data/last-month-holds.csv',
    'data/branch-statistics.csv',
    'policy/circulation.md',
    'policy/branches.md',
    'policy/childrens-policy.md',
    'data/patron-survey-summary.md',
    'ebooks/vendor-license-summary.md',
    'board/memo-2024-01-05.md',
    'accessibility/statement.md',
    'meetings/staff-interview-2023-12-10.md',
    'meetings/technical-review-2023-12-18.md'
  ] 
});