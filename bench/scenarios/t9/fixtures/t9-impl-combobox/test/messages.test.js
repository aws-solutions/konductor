import test from 'node:test';
import assert from 'node:assert/strict';
import { messageFor } from '../src/messages.js';

test('known form messages are available', () => assert.match(messageFor('saved'), /registration/));
test('unknown form messages stay empty', () => assert.equal(messageFor('other'), ''));
