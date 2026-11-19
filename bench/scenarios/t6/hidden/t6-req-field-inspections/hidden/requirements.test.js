const test = require('node:test');
const assert = require('node:assert/strict');
const { scriptedSuite } = require('./doc-key');

scriptedSuite(test, assert, {
  doc: 'docs/requirements.md',
  facts: [
    {
      id: 'F1',
      all: [/8\s*hours?/i, /offline|without (?:a )?signal|queue.*(?:sync|submit)/i],
      wrong: [/4\s*hours?/i, /24\s*hours?/i]
    },
    {
      id: 'F2',
      all: [/12\s+(?:rugged )?tablets?/i, /shared/i, /asset tag/i],
      wrong: [/1[01]\s+tablets?/i, /one tablet per inspector/i]
    },
    {
      id: 'F3',
      all: [/4\s+(?:photos?|images?)/i, /original resolution/i, /people|vehicle plates?|license plates?/i],
      wrong: [/5\s+(?:photos?|images?)/i, /resize|compress/i]
    },
    {
      id: 'F4',
      all: [/both versions/i, /field[- ]lead/i, /never silently overwrite|not silently overwrite/i],
      wrong: [/last write wins/i, /latest.*wins/i]
    },
    {
      id: 'F5',
      all: [/inspector.*attest|attest.*inspector/i, /field lead.*approv|approv.*field lead/i, /2 business days/i],
      wrong: [/24 hours/i, /same day/i]
    },
    {
      id: 'F6',
      all: [/chlorine smell/i, /exposed electrical/i, /unstable ground/i],
      wrong: [/continue.*inspection/i, /photo.*before.*stop/i]
    }
  ],
  ground: [
    'README.md',
    'docs/paper-form.md',
    'docs/asset-catalog.md',
    'docs/interview-mara.md',
    'docs/interview-jon.md',
    'docs/interview-safety.md',
    'docs/coverage-map.md',
    'docs/records-policy.md',
    'docs/it-standards.md',
    'docs/operations-notes.md',
    'docs/old-requirements-draft.md',
    'docs/review-comments.md',
    'docs/shift-handoff.md',
    'docs/vendor-note.md',
    'docs/meeting-2025-02-14.md',
    'docs/holiday-calendar.md',
    'docs/notification-copy.md',
    'docs/asset-register-notes.md',
    'data/inspection-log-q4.csv',
    'data/asset-register.csv',
    'data/crew-roster.csv',
    'data/coverage-samples.csv',
    'data/issue-codes.csv',
    'data/photo-index.csv',
    'data/sync-test.csv',
    'data/archive-export.csv',
    'data/route-plan.csv',
    'data/field-form-scan-index.csv'
  ],
  extraNumbers: ['8', '12', '4', '2']
});
