import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationSummary } from '../src/form.js';

test('registration summary joins the two public fields', () => assert.equal(registrationSummary({ attendee_name: 'Mina', email: 'm@example.test' }), 'Mina · m@example.test'));
