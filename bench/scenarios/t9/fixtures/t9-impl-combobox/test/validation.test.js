import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmail, required } from '../src/validation.js';

test('email validation accepts a simple address', () => assert.equal(isEmail('crew@example.test'), true));
test('required validation trims whitespace', () => assert.equal(required('   '), false));
