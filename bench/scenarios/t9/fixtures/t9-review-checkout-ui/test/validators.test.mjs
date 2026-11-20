import test from 'node:test';
import assert from 'node:assert/strict';
import { isCardNumber, isPostcode, required } from '../src/utils/validators.js';

test('card validator accepts a spaced card number', () => assert.equal(isCardNumber('4242 4242 4242 4242'), true));
test('postcode validator accepts normal postal input', () => assert.equal(isPostcode('AB12 3CD'), true));
test('required rejects blank values', () => assert.equal(required('   '), false));
