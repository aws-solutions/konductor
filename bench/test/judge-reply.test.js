// SPDX-License-Identifier: Apache-2.0
/**
 * Reply reading tests: finding the one JSON object in a judge's reply text and handing it to the
 * scale's parser. Pure.
 * Run: node --test bench/test/judge-reply.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseReply, extractObject, MAX_REPLY_CHARS } = require('../lib/judge-reply');

const GOOD = '{"winner":"A","score_a":4,"score_b":2,"reason":"A is complete"}';

test('a bare JSON object on the overall scale is read', () => {
  assert.deepEqual(parseReply('overall', GOOD), {
    winner: 'A',
    score_a: 4,
    score_b: 2,
    reason: 'A is complete',
    problem: null,
  });
});

test('prose or a code fence around the object is tolerated', () => {
  for (const text of [
    `Here is my verdict:\n${GOOD}\nThanks.`,
    `\`\`\`json\n${GOOD}\n\`\`\``,
    `\n\n  ${GOOD}  \n`,
  ]) {
    const got = parseReply('overall', text);
    assert.equal(got.winner, 'A', text);
    assert.equal(got.score_a, 4);
  }
});

test('braces and quotes inside a string value do not confuse the reading', () => {
  const text = '{"winner":"B","score_a":2,"score_b":5,"reason":"B uses {braces} and a \\"quote\\""}';
  const got = parseReply('overall', text);
  assert.equal(got.winner, 'B');
  assert.equal(got.reason, 'B uses {braces} and a "quote"');
});

test('a reply with no object, broken JSON or two objects is unusable', () => {
  const cases = [
    ['no braces', 'A is better.', /no JSON object/],
    ['only a closing brace', 'oops }', /no JSON object/],
    ['closing before opening', '} then {', /no JSON object/],
    ['cut off before the closing brace', '{"winner":"A","score_a":4,', /no JSON object/],
    ['missing comma', '{"winner":"A" "score_a":4}', /not one valid JSON object/],
    ['trailing comma', '{"winner":"A","score_a":4,"score_b":2,}', /not one valid JSON object/],
    ['two objects', `${GOOD}\nand also\n${GOOD}`, /not one valid JSON object/],
    ['single quotes', "{'winner':'A'}", /not one valid JSON object/],
  ];
  for (const [name, text, problem] of cases) {
    const got = parseReply('overall', text);
    assert.equal(got.winner, null, name);
    assert.match(got.problem, problem, name);
    assert.equal(got.score_a, null);
    assert.equal(got.score_b, null);
  }
});

test('an empty, missing or oversize reply is unusable', () => {
  for (const text of ['', '   \n', null, undefined, 7, {}]) {
    assert.match(parseReply('overall', text).problem, /empty/, String(text));
  }
  const long = `${GOOD}${' '.repeat(MAX_REPLY_CHARS)}`;
  assert.match(parseReply('overall', long).problem, /longer than/);
  assert.equal(parseReply('overall', `${GOOD}${' '.repeat(MAX_REPLY_CHARS - GOOD.length)}`).winner, 'A');
});

test('the scale decides what is usable: winner, scores and their agreement', () => {
  const bad = [
    ['unknown winner', '{"winner":"C","score_a":4,"score_b":2}', /winner is not A, B or TIE/],
    ['missing scores', '{"winner":"A"}', /integers from 1 to 5/],
    ['fractional score', '{"winner":"A","score_a":4.5,"score_b":2}', /integers from 1 to 5/],
    ['out of range', '{"winner":"A","score_a":6,"score_b":2}', /integers from 1 to 5/],
    ['winner contradicts scores', '{"winner":"A","score_a":2,"score_b":4}', /contradicts the scores/],
    ['tie too far apart', '{"winner":"TIE","score_a":5,"score_b":2}', /TIE needs scores/],
  ];
  for (const [name, text, problem] of bad) {
    const got = parseReply('overall', text);
    assert.equal(got.winner, null, name);
    assert.match(got.problem, problem, name);
  }
  assert.equal(parseReply('overall', '{"winner":"A","score_a":3,"score_b":3}').winner, 'A');
});

test('the items scale reads one label per checklist item and derives the winner and scores', () => {
  const text = '{"items_a":["MET","MET"],"items_b":["MISSING","PARTIAL"],"reason":"r"}';
  const got = parseReply('items', text, { rubricLength: 2 });
  assert.equal(got.winner, 'A');
  assert.equal(got.score_a, 5);
  assert.equal(got.score_b, 1 + 4 * 0.25);
  assert.deepEqual(got.items_b, ['MISSING', 'PARTIAL']);
  assert.equal(parseReply('items', text, { rubricLength: 3 }).winner, null, 'wrong label count');
  assert.equal(parseReply('items', GOOD, { rubricLength: 2 }).winner, null, 'overall reply on items');
});

test('an unknown scale throws instead of guessing', () => {
  assert.throws(() => parseReply('vote', GOOD), /unknown judge scale/);
});

test('extractObject returns the value or a problem, and never an array', () => {
  assert.deepEqual(extractObject('x {"a":1} y').value, { a: 1 });
  assert.match(extractObject('no object').problem, /no JSON object/);
  assert.match(extractObject('{ [1,2] }').problem, /not one valid JSON object/);
  assert.deepEqual(extractObject('{"__proto__":{"polluted":true}}').value.__proto__, { polluted: true });
  assert.equal({}.polluted, undefined);
});
