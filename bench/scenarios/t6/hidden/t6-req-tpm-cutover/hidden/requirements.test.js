const test = require('node:test');
const assert = require('node:assert/strict');
const { scriptedSuite } = require('./doc-key');

scriptedSuite(test, assert, { 
  doc: 'docs/requirements.md', 
  facts: [
    { 
      id: 'F1', 
      all: [/april.*15|tax.*freeze|freeze.*april|blackout.*april/i, /avoid.*freeze|cannot.*cut|block.*change|no.*change|absolute.*freeze/i],
      wrong: []
    },
    { 
      id: 'F2',
      all: [/15.*minute|fifteen.*minute/i, /maximum.*downtime|downtime.*limit|service.*degradation/i],
      wrong: [/downtime[^.]{0,40}\b5\s*minute|downtime[^.]{0,40}five[^.]{0,20}minute|downtime[^.]{0,40}\b30\s*minute|downtime[^.]{0,40}thirty[^.]{0,20}minute/i]
    },
    {
      id: 'F3',
      all: [/20.*minute|twenty.*minute|T\+20|within.*20/i, /rollback.*automatic|automatic.*rollback/i],
      wrong: [/rollback[^.]{0,40}\b30\s*minute|rollback[^.]{0,40}thirty[^.]{0,20}minute|rollback[^.]{0,40}\b15\s*minute[^.]{0,20}complete|complete[^.]{0,40}\b15\s*minute[^.]{0,20}rollback/i]
    },
    {
      id: 'F4',
      all: [/sarah.*johnson|vp.*engineering/i, /alex.*rodriguez.*lisa.*wong|platform.*lead.*payment.*lead/i],
      wrong: []
    },
    {
      id: 'F5',
      all: [/single.*partition|one.*partition/i, /2000.*message|2,000.*message|two.*thousand/i],
      wrong: [/partition[^.]{0,40}\b10\b|partition[^.]{0,40}ten[^.]{0,20}partition|multiple[^.]{0,40}partition[^.]{0,20}payment/i]
    },
    {
      id: 'F6',
      all: [/21.*day|twenty.*one.*day|three.*week/i, /dual.*run|both.*system|parallel.*run/i],
      wrong: [/dual[^.]{0,40}\b30\s*day|dual[^.]{0,40}thirty[^.]{0,20}day|dual[^.]{0,40}one[^.]{0,20}month/i]
    }
  ], 
  ground: [
    'data/message-volumes.csv',
    'data/change-calendar.csv',
    'data/performance-metrics.json',
    'data/service-dependencies.csv',
    'data/rabbitmq-contract.md',
    'data/timezone-analysis.md',
    'policies/change-management.md'
  ],
  minRequirements: 11,
  maxQuestions: 6,
  minPrecision: 0.8,
  extraNumbers: ['14', '2', '12', '6', '02', '06', '26', '27', '15', '20', '10', '2000']
});