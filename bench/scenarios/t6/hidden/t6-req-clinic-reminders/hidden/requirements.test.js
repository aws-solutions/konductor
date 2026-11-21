const test = require('node:test');
const assert = require('node:assert/strict');
const { scriptedSuite } = require('./doc-key');

scriptedSuite(test, assert, {
  doc: 'docs/requirements.md',
  facts: [
    { id: 'F1', all: [/20:00|8:00\s*p\.?m\.?/i, /08:00|8:00\s*a\.?m\.?/i, /local time/i], wrong: [/21:00/i, /07:00/i] },
    { id: 'F2', all: [/exactly\s+two|2\s+reminders/i, /72\s*(?:hours?|hrs?)/i, /24\s*(?:hours?|hrs?)/i], wrong: [/48\s*(?:hours?|hrs?)/i, /7\s*days?/i] },
    { id: 'F3', all: [/first name/i, /clinic name/i, /omit|exclud|not include|n't include|never include|without|leave out|no (?:provider|treatment|diagnos)/i, /diagnos/i, /treatment/i], wrong: [/include (?:the )?(?:diagnosis|treatment)/i] },
    { id: 'F4', all: [/English/i, /Spanish/i, /other.*English|English.*other/i], wrong: [/Vietnamese.*template|template.*Vietnamese/i] },
    { id: 'F5', all: [/STOP/i, /END/i, /UNSUBSCRIBE/i], wrong: [/call.*front desk.*before|manual.*call/i] },
    { id: 'F6', all: [/(?:non[- ]opt[- ]out|ordinary) repl/i, /60\s*minutes?/i, /front[- ]desk task/i], wrong: [/ordinary repl.*24\s*hours?/i] },
    { id: 'F7', all: [/Cedar Grove/i, /Harbor Point/i, /Northgate[^.;]{0,60}(?:March 17|17 March|03-17)|(?:March 17|17 March|03-17)[^.;]{0,60}Northgate/i, /March 3\b|3 March|03-03/i], wrong: [/all three.*same day|same day.*all three/i] }
  ],
  ground: [
    'booking-process.md', 'front-desk-interview-2024-11-14.md', 'front-desk-interview-2024-11-19.md',
    'meeting-notes-2024-12-02.md', 'meeting-notes-2025-01-08.md', 'clinic-directory.csv',
    'clinic-east-profile.md', 'clinic-west-profile.md', 'clinic-river-profile.md', 'no-show-report.csv',
    'appointment-export.csv', 'patient-intake.csv', 'vendor-quote.txt', 'vendor-security-questionnaire.md',
    'privacy-policy.md', 'sms-provider-handbook.md', 'intake-form.md', 'front-desk-cheatsheet.md',
    'data-dictionary.md', 'brand-voice.md', 'old-reminder-draft.md', 'requirements-outline.md',
    'clinic-hours-sheet.csv', 'decision-log.md', 'archive/2023-email-thread.txt', 'archive/2024-vendor-demo.csv'
  ],
  extraNumbers: ['8', '20', '72', '24', '60', '2025', '3', '17']
});
