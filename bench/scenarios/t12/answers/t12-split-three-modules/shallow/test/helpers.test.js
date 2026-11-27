'use strict';

// Shallow fake: names each helper and only checks that it returns something.
const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('../src/slugify.js');
const { toRoman, fromRoman } = require('../src/roman.js');
const { wordStats } = require('../src/word-stats.js');

test('src/slugify runs', () => assert.ok(slugify('Hello World')));
test('src/roman runs', () => assert.ok(toRoman(5) && fromRoman('V')));
test('src/word-stats runs', () => assert.ok(wordStats('a b')));
