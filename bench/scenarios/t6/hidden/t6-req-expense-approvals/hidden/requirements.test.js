const test = require('node:test');
const assert = require('node:assert/strict');
const { scriptedSuite } = require('./doc-key');

scriptedSuite(test, assert, { 
  doc: 'docs/requirements.md', 
  facts: [
    { 
      id: 'F1', 
      all: [/\b1000\b|\b1,000\b/i, /\bsecond\b.*\bapprover\b|\bsecondary\b.*\bapproval\b|\bdual\b.*\bapproval\b/i],
      wrong: [/\b500\b.*\bsecond\b|\b500\b.*\bsecondary\b/i, /\b2000\b.*\bsecond\b|\b2,000\b.*\bsecondary\b/i]
    },
    { 
      id: 'F2', 
      all: [/\b100\b|\b£100\b/i, /\bself.*approv|\bown\s+(?:expense|claim)|approv\w*\s+(?:their|his|her)\s+own/i],
      wrong: [/\b50\b.*self|\b£50\b.*self/i, /\b200\b.*self|\b£200\b.*self/i, /\bno self.*approv/i]
    },
    { 
      id: 'F3', 
      all: [/\bphoto.*receipt|\bdigital.*receipt|\belectronic.*receipt|\bscanned.*receipt/i, /\baccept|\ballow|\bvalid/i],
      wrong: [/\bno\s+(?:receipt\s+)?photos?\b|\bnot\s+accept\w*\s+(?:receipt\s+)?photos?|\bpaper(?:\s+receipts?)?\s+only/i]
    },
    { 
      id: 'F4', 
      all: [/£?\b60\b|\bsixty\b/i, /\bdaily|\bper.*diem|subsistence/i],
      wrong: [/£?\b75\b[^.]{0,40}(daily|subsistence)/i, /(daily|subsistence)[^.]{0,40}£?\b75\b/i]
    },
    { 
      id: 'F5', 
      all: [/\b10(th)?\b.*\b25(th)?\b|\btenth.*twenty.*fifth/i, /\bpayment.*run|\bpayment.*date|\bpayment.*cycle/i],
      wrong: [/\b15(th)?\b.*payment/i, /\b5(th)?\b.*payment/i, /\bend.*month.*payment/i]
    },
    { 
      id: 'F6', 
      all: [/\bdelegat.*advance|\bset.*up.*advance|\bpre.*set.*delegat/i, /\baway|\babsent|\bholiday|\bcover/i],
      wrong: [/automatic(?:ally)?\s+(?:assign|creat|pick|choos|appoint)\w*\s+(?:a\s+|the\s+)?(?:deputy|delegate)|auto[- ]assign\w*\s+(?:a\s+|the\s+)?(?:deputy|delegate)/i, /\bno\s+delegation\b|delegation\s+is\s+not\s+(?:allowed|supported)/i]
    }
  ], 
  ground: [
    'handbook/finance-policy-excerpt.md',
    'data/claims-2023.csv',
    'grants-list.md',
    'handbook/travel-policy.md',
    'data/analysis-2023.md'
  ],
  minRequirements: 5,
  minPrecision: 0.8
});