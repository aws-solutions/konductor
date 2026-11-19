const test = require('node:test');
const assert = require('node:assert/strict');
const { scriptedSuite } = require('./doc-key');

scriptedSuite(test, assert, {
  doc: 'docs/requirements.md',
  facts: [
    {
      id: 'F1',
      all: [/account owner/i, /Account Data Export permission/i],
      wrong: [/all administrators/i, /any administrator/i]
    },
    {
      id: 'F2',
      all: [/ZIP/i, /CSV/i, /UTC/i],
      wrong: [/CSV only/i]
    },
    {
      id: 'F3',
      all: [/payment card/i, /internal (?:support )?notes/i, /deleted appointment/i],
      wrong: [/include payment card/i]
    },
    {
      id: 'F4',
      all: [/15\s*minutes/i, /72\s*hours/i],
      wrong: [/48\s*hours/i]
    },
    {
      id: 'F5',
      all: [/signed download link/i, /7\s*days/i],
      wrong: [/24\s*hours/i]
    },
    {
      id: 'F6',
      all: [/2\s*GB/i, /compressed/i],
      wrong: [/10\s*GB/i]
    },
    {
      id: 'F7',
      all: [/Pro and Enterprise/i, /Starter/i],
      wrong: [/Starter[^.]{0,40}included/i]
    },
    {
      id: 'F8',
      all: [/export\.requested/i, /400\s*days/i],
      wrong: [/365\s*days/i]
    }
  ],
  ground: [
    'README.md',
    'docs/product-overview.md',
    'docs/data-model.md',
    'docs/privacy-notice.md',
    'docs/admin-roles.md',
    'docs/infra-limits.md',
    'docs/legal-team-email.md',
    'docs/enterprise-questionnaire.md',
    'docs/support-export-tickets.csv',
    'docs/meeting-notes.md',
    'docs/customer-interview.md',
    'docs/old-export-draft.md',
    'docs/retention-handbook.md',
    'docs/api-conventions.md',
    'docs/operations-runbook.md',
    'docs/roadmap.md',
    'docs/account-plan-matrix.csv',
    'docs/locale-timezones.csv',
    'docs/audit-events.csv',
    'data/users.csv',
    'data/appointments.csv',
    'data/availability.csv',
    'data/rooms.csv',
    'data/custom-fields.csv',
    'data/integrations.csv',
    'data/billing-snapshot.csv',
    'data/support-cases.csv'
  ]
});
