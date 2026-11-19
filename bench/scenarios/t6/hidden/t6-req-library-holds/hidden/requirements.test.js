const test = require('node:test');
const assert = require('node:assert/strict');
const { scriptedSuite } = require('./doc-key');

scriptedSuite(test, assert, { 
  doc: 'docs/requirements.md', 
  facts: [
    { 
      id: 'F1', 
      all: [/regular.*12/i, /student.*15/i, /senior.*10/i, /children.*5/i, /institutional.*20/i],
      wrong: [/regular[^.]{0,30}\b(15|20|25)\s*items/i, /student[^.]{0,30}\b(10|5|20)\s*items/i]
    },
    { 
      id: 'F2', 
      all: [/north.*hill.*10.*day/i, /central.*after.*hours/i],
      wrong: [/north[^.]{0,30}\b(7|5|3)\s*days/i, /central[^.]{0,30}no.*after.*hours/i]
    },
    { 
      id: 'F3', 
      all: [/parent.*notification.*default/i, /opt.*out.*in.*person/i],
      wrong: [/parent.*opt[ -]?in/i, /no.*parent.*notification/i]
    },
    { 
      id: 'F4', 
      all: [/24.*hour.*checkout/i, /one.*automatic.*renewal/i],
      wrong: [/48.*hour.*checkout/i, /\bno\s+renewal/i]
    },
    { 
      id: 'F5', 
      all: [/email.*primary/i, /sms.*backup/i, /phone.*call.*senior/i],
      wrong: [/text.*primary/i, /email.*optional/i]
    },
    { 
      id: 'F6', 
      all: [/march.*1.*2024/i, /existing.*fines/i, /60.*days/i],
      wrong: [/all.*fines.*waived/i, /\bno\s+appeal/i]
    },
    { 
      id: 'F7', 
      all: [/wcag.*launch/i, /6.*month.*grace/i],
      wrong: [/all.*features.*wcag/i, /\bno\s+grace.*period/i]
    },
    { 
      id: 'F8', 
      all: [/bookmobile.*phase.*2/i, /august.*2024/i, /school.*delivery.*excluded/i],
      wrong: [/bookmobile.*phase.*1/i, /school.*delivery.*included/i]
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