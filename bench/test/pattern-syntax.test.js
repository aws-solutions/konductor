// SPDX-License-Identifier: Apache-2.0
/**
 * Pattern Syntax unit tests
 *
 * Run: node --test bench/test/pattern-syntax.test.js
 *
 * The parser decides which patterns are rejected as matching arbitrary prose (C-3) and builds the
 * keyword-stuffed workspace (C-1), so it is tested against the real regular expression engine:
 * the computed minimum length must never exceed the shortest text that engine really matches, and
 * every candidate text must be checked with the real expression before anyone relies on it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  MAX_SMALL_NEST,
  MAX_VARIABLE_QUANTIFIERS,
  WIDE_REPEAT,
  MAX_WIDE_QUANTIFIERS,
  parsePattern,
  minMatchLength,
  minSpanLength: minSpanLengthExport,
  hasLookaround,
  plainLiteral,
  literalRuns,
  backtrackingRisk,
  candidateMatches,
  MAX_WITNESS_STEPS,
} = require('../lib/pattern-syntax');

const FLAGS = 'imu'; // I-9: the flags checks.js compiles with

// --- Minimum lengths --------------------------------------------------------------------------

test('minMatchLength counts the characters every match must consume', () => {
  const cases = [
    ['ab', 2], ['a', 1], ['.', 1], ['\\.', 1], ['\\d\\d', 2], ['[abc]', 1], ['[^x]{3}', 3], ['a+', 1], ['a*', 0], ['a?b', 1],
    ['a|bcd', 1], ['(ab|c)d', 2], ['(?:ab){2,}', 4], ['ab{2}', 3], ['\\bword\\b', 4], ['^# ', 2], ['\\b', 0], ['(?=a)', 0],
    ['(?<=a)b', 1], ['(?<=a)', 0], ['(?!a)bc', 2], ['\\u0041\\x42', 2], ['\\cJ', 1], ['a{', 2], ['a{,3}', 5], ['x{2,1}y'.replace('{2,1}', '{1,2}'), 2],
    ['[]]', 2], ['[\\]]x', 2], ['(a)\\1', 1], ['(?<n>ab)\\k<n>', 2],
    // I-9: with the `u` flag these are one character each. Without it `\u{41}` was the letter u
    // forty-one times and `\p{L}` was four characters.
    ['\\u{41}', 1], ['\\u{1F600}', 1], ['\\uD83D\\uDE00', 1], ['\\p{L}', 1], ['\\P{L}\\p{Lu}', 2], ['[\\p{L}]x', 2],
  ];
  for (const [pattern, expected] of cases) assert.equal(minMatchLength(pattern), expected, pattern);
});

test('C: minSpanLength is gone, and minMatchLength counts only what a match consumes', () => {
  // Behavior change (C): this test asserted minSpanLength('(?<=price )\\d+(?= USD)') === 11. The
  // function was deleted: counting lookaround text is what admitted `t(?=h)` and its relatives.
  assert.equal(minSpanLengthExport, undefined);
  assert.equal(minMatchLength('(?<=price )\\d+(?= USD)'), 1);
  assert.equal(minMatchLength('t(?=h)'), 1);
  assert.equal(minMatchLength('(?=ab)'), 0);
});

test('C: hasLookaround reads the parse tree, so only a real lookaround counts', () => {
  for (const source of ['a(?=b)', 'a(?!b)', '(?<=a)b', '(?<!a)b', '(?:x(?=y))+', '(x|(?<=a)y)z', '((?=a)b)']) {
    assert.equal(hasLookaround(source), true, source);
  }
  for (const source of ['ab', '\\(?=ab', 'a[(?=]b', '(?:ab)', '(?<n>ab)\\k<n>', 'a(?:b)?']) {
    assert.equal(hasLookaround(source), false, source);
  }
  for (const source of [undefined, null, 5, '(', '(?', '[a']) assert.equal(hasLookaround(source), null, String(source));
});

test('an unparsable or non-string source gives null instead of throwing', () => {
  for (const source of [undefined, null, 5, {}, '(', ')', '[a', 'a\\', '(?', '(?<n', '*a']) {
    assert.equal(minMatchLength(source), null, String(source));
    assert.equal(plainLiteral(source), null, String(source));
    assert.deepEqual(literalRuns(source), [], String(source));
    assert.deepEqual(candidateMatches(source), [], String(source));
    assert.equal(parsePattern(source), null, String(source));
    assert.equal(backtrackingRisk(source), null, String(source));
  }
});

test('the computed minimum never exceeds the shortest text the real engine matches', () => {
  const patterns = [
    'ab', 'a|bc', '(ab|c)d', 'a+b', 'a*b', 'a?b?', '[ab]c', '\\d\\w', '\\bab', 'ab\\b', '(?:ab)+', '(a)\\1', '(?<=a)b', 'a(?=b)',
    '(?!a)b', 'a{2}', 'a{1,2}b', '^ab', 'ab$', '.', '..', '.b', '[^a]b', 'a|', '(a|b)(c|d)', 'a(b|)c', '\\sa', 'a\\s', '[a-c]{2}',
  ];
  const alphabet = ['a', 'b', 'c', 'd', '1', ' ', '\n'];
  const texts = [''];
  for (let length = 1; length <= 4; length += 1) {
    for (const prefix of texts.filter((t) => t.length === length - 1)) for (const c of alphabet) texts.push(prefix + c);
  }
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, FLAGS);
    let shortest = Infinity;
    for (const text of texts) {
      const match = regex.exec(text);
      if (match) shortest = Math.min(shortest, match[0].length);
    }
    const computed = minMatchLength(pattern);
    assert.ok(computed <= shortest, `${pattern}: computed ${computed}, engine found ${shortest}`);
  }
});

// --- Plain literals ---------------------------------------------------------------------------

test('plainLiteral recognizes literal characters, escaped or not, with optional edge anchors', () => {
  assert.deepEqual(plainLiteral('plan'), { text: 'plan', first: 'p', last: 'n' });
  assert.deepEqual(plainLiteral('--dry-run'), { text: '--dry-run', first: '-', last: 'n' });
  assert.deepEqual(plainLiteral('\\$5 \\(est\\.\\)'), { text: '$5 (est.)', first: '$', last: ')' });
  assert.deepEqual(plainLiteral('^plan$'), { text: 'plan', first: 'p', last: 'n' });
  assert.deepEqual(plainLiteral('caf\u00e9'), { text: 'caf\u00e9', first: 'c', last: '\u00e9' });
});

test('plainLiteral refuses anything with structure', () => {
  for (const pattern of ['a|b', 'ab?', 'a.b', '[ab]c', '\\bword\\b', '(ab)', '(?:ab)', '(?=a)b', 'a{2}', '\\d', 'a\\sb', '^', '', 'a$b']) {
    assert.equal(plainLiteral(pattern), null, pattern);
  }
});

test('literalRuns lists the unquantified literal text between structure', () => {
  assert.deepEqual(literalRuns('roll(s|ed)? back (the )?(change|deploy(ment)?)'), ['roll', 's', 'ed', ' back ', 'the ', 'change', 'deploy', 'ment']);
  assert.deepEqual(literalRuns('plan'), ['plan']);
  assert.deepEqual(literalRuns('\\d+ items'), [' items']);
  assert.deepEqual(literalRuns('ab+c'), ['a', 'c']);
});

// --- Candidate texts --------------------------------------------------------------------------

test('candidateMatches builds texts the real expression accepts for common shapes', () => {
  const patterns = [
    'plan', '--dry-run', 'roll(s|ed)? back (the )?(change|deploy(ment)?)', '^# Title$', '\\bword\\b', '\\d{3}-\\d{2}', '[A-Z][a-z]+ [0-9]+', '(ab)\\1',
    '(?<=price )\\d+(?= USD)', 'a.b', '\\s\\S\\w\\W', '[^a-z]x', '(?<w>go) \\k<w>', 'colou?r', 'x{2,4}y', '\\u0041\\x42', 'a|b|cd',
  ];
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, FLAGS);
    const candidates = candidateMatches(pattern);
    assert.ok(candidates.length > 0, pattern);
    assert.ok(candidates.some((text) => regex.test(text)), `${pattern}: none of ${JSON.stringify(candidates)} matches`);
  }
});

test('candidateMatches tries more than the first alternation branch', () => {
  const candidates = candidateMatches('foo|bar|baz');
  assert.ok(candidates.includes('foo') && candidates.includes('bar') && candidates.includes('baz'), JSON.stringify(candidates));
});

test('candidateMatches refuses an oversized expansion instead of building it', () => {
  assert.deepEqual(candidateMatches('a{100000}'), []);
});

test('candidateMatches gives no text for a class that has no member', () => {
  assert.deepEqual(candidateMatches('[]x'), []);
});

// --- A: the work to build a candidate is bounded, not only its length ---------------------------

/** The review's b2.js pattern: four nested {200} repeats around an empty body, then "ab". */
function emptyBodyNest(depth) {
  let inner = '';
  for (let i = 0; i < depth; i += 1) inner = `(?:${inner}){200}`;
  return `ab${inner}`;
}

/**
 * Runs `candidateMatches(pattern)` in a child process and kills it after `limitMs`. A call that
 * never returns blocks this process's event loop, so the test runner's own timeout cannot fire; a
 * child makes "does not return" a failing assertion and not a stuck test run.
 */
function candidatesInChild(pattern, limitMs) {
  const script = `const { candidateMatches } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'pattern-syntax.js'))}); process.stdout.write(JSON.stringify(candidateMatches(${JSON.stringify(pattern)})));`;
  const started = process.hrtime.bigint();
  const run = spawnSync(process.execPath, ['-e', script], { timeout: limitMs, killSignal: 'SIGKILL', encoding: 'utf8' });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { ms, timedOut: run.error !== undefined && run.error.code === 'ETIMEDOUT', candidates: run.status === 0 ? JSON.parse(run.stdout) : null };
}

test('A: an empty-body quantifier nest is cut off by the step budget instead of running for 200^4 visits', () => {
  // Before, the 5,000-character cap never tripped because the body adds no text, so this call did not return.
  const { timedOut, candidates, ms } = candidatesInChild(emptyBodyNest(4), 20000);
  assert.equal(timedOut, false, 'candidateMatches did not return within 20 s');
  assert.deepEqual(candidates, []);
  assert.ok(ms < 10000, `took ${ms} ms`);
});

test('A: a nest that fits the budget still builds, and the budget is per variant', () => {
  // 200 * 3 visits is far under the budget; 200^2 = 40,000 is over it.
  assert.ok(MAX_WITNESS_STEPS < 200 * 200);
  assert.deepEqual(candidateMatches(emptyBodyNest(1)), ['ab']);
  assert.deepEqual(candidateMatches(emptyBodyNest(2)), []);
});

test('A: a wide pattern with an empty alternative branch and a nested group is bounded too', () => {
  for (const pattern of ['ab(?:(?:){200}|c){200}(?:(?:){200}){200}', '(?:(?:(?:x?){200}){200}){200}yy']) {
    const { timedOut, ms } = candidatesInChild(pattern, 20000);
    assert.equal(timedOut, false, `${pattern} did not return within 20 s`);
    assert.ok(ms < 10000, `${pattern} took ${ms} ms`);
  }
});

// --- Unicode mode (I-9) -----------------------------------------------------------------------

test('I-9: candidateMatches builds texts the unicode-mode engine accepts for property and code point escapes', () => {
  for (const pattern of ['\\p{Lu}\\p{Ll}+', '\\P{L}x', '[\\p{L}\\d]{3}', '\\u{41}b', 'x\\u{1F600}', '\\uD83D\\uDE00x', 'caf\\u{e9}']) {
    const regex = new RegExp(pattern, FLAGS);
    const candidates = candidateMatches(pattern);
    assert.ok(candidates.some((text) => regex.test(text)), `${pattern}: none of ${JSON.stringify(candidates)} matches`);
  }
});

test('I-9: plainLiteral reads a code point escape as the one character it names', () => {
  assert.deepEqual(plainLiteral('caf\\u{e9}'), { text: 'caf\u00e9', first: 'c', last: '\u00e9' });
  assert.deepEqual(plainLiteral('a\\uD83D\\uDE00'), { text: 'a\ud83d\ude00', first: 'a', last: '\ud83d\ude00' });
  assert.equal(plainLiteral('\\p{L}'), null);
});

test('I-9: a code point above U+10FFFF is not analyzable', () => {
  assert.equal(parsePattern('\\u{110000}'), null);
  assert.equal(parsePattern('\\p'), null);
});

// --- Backtracking risk (I-1) ------------------------------------------------------------------

test('I-1: backtrackingRisk names a repeat around a variable-length part', () => {
  for (const pattern of ['(a+)+', '(a*)*', '(\\w+\\s?)+:', '(?:a|b+)*', '(?:(?=a+)b)+', '((a+){2}){2}', '(?:a{1,5}){1,2}', '(?:a+){2}']) {
    assert.match(backtrackingRisk(pattern), /nested quantifier/, pattern);
  }
});

test('I-1: a small repeat around a small range is allowed, and the limit is exactly MAX_SMALL_NEST', () => {
  assert.equal(MAX_SMALL_NEST, 4);
  assert.equal(backtrackingRisk(`(?:a{1,${MAX_SMALL_NEST}}){1,${MAX_SMALL_NEST}}b`), null);
  assert.match(backtrackingRisk(`(?:a{1,${MAX_SMALL_NEST + 1}}){1,${MAX_SMALL_NEST}}b`), /nested quantifier/);
  assert.match(backtrackingRisk(`(?:a{1,${MAX_SMALL_NEST}}){1,${MAX_SMALL_NEST + 1}}b`), /nested quantifier/);
  assert.equal(backtrackingRisk('(?:\\d{1,3}\\.){3}\\d+'), null);
  // A fixed-size inner part has one way to split, however many times it repeats.
  assert.equal(backtrackingRisk('(?:ab){1000}c'), null);
  assert.equal(backtrackingRisk('(?:\\d{4}-){2}x'), null);
});

test('I-1: backtrackingRisk names a repeated alternation whose branches can start alike', () => {
  for (const pattern of ['(a|aa)+', '(a|a)*', '(?:ab|a)+', '(x|)+', '(?:a|[ab])+', '(?:AB|ab){2}', '(?:(?:ab)|a)+', '(?:a(?:b|c)|ad)+']) {
    assert.match(backtrackingRisk(pattern), /alternation whose branches can start with the same character/, pattern);
  }
  assert.equal(backtrackingRisk('(?:foo|bar|baz)+'.replace('baz', 'qux')), null);
  assert.equal(backtrackingRisk('(?:x|y|z){3}'), null);
  // Not repeated more than once, so there is nothing to split.
  assert.equal(backtrackingRisk('(?:a|aa)?b'), null);
  assert.equal(backtrackingRisk('(a|aa)b'), null);
});

test('I-1: backtrackingRisk caps how many variable quantifiers one pattern holds', () => {
  assert.equal(MAX_VARIABLE_QUANTIFIERS, 10);
  assert.equal(backtrackingRisk('a?'.repeat(MAX_VARIABLE_QUANTIFIERS)), null);
  assert.match(backtrackingRisk('a?'.repeat(MAX_VARIABLE_QUANTIFIERS + 1)), /optional or variable-length parts/);
  // Exact repeats do not vary, so any number of them is fine.
  assert.equal(backtrackingRisk('a{2}'.repeat(40)), null);
});

test('I-1: backtrackingRisk caps how many open-ended quantifiers one pattern holds', () => {
  assert.equal(WIDE_REPEAT, 16);
  assert.equal(MAX_WIDE_QUANTIFIERS, 2);
  assert.equal(backtrackingRisk('a*a*b'), null);
  assert.match(backtrackingRisk('a*a*a*b'), /3 open-ended quantifiers/);
  assert.match(backtrackingRisk('a.*b.*c.*d'), /3 open-ended quantifiers/);
  assert.match(backtrackingRisk('roll\\s+back\\s+the\\s+change'), /3 open-ended quantifiers/);
  // A range counts as open-ended only above WIDE_REPEAT, so a bounded form is the way out.
  assert.equal(backtrackingRisk('roll\\s{1,16}back\\s{1,16}the\\s{1,16}change'), null);
  assert.match(backtrackingRisk('a{1,17}b{1,17}c{2,}'), /3 open-ended quantifiers/);
  assert.equal(backtrackingRisk('a{16}b{20}c{3,3}d?'), null);
});

test('I-1: backtrackingRisk finds a risk inside a lookaround or a capture group', () => {
  assert.match(backtrackingRisk('x(?=(a+)+)'), /nested quantifier/);
  assert.match(backtrackingRisk('x(?<!(?:a|ab)+)y'), /alternation/);
});

test('I-1: a pattern the syntax rules accept is not one of the exponential shapes', () => {
  // The rules are conservative, not complete: a safe pattern may be rejected, never the reverse for
  // these shapes. Run the accepted shapes against text built to make a backtracker struggle.
  const accepted = ['(?:foo|bar)+x', '^#+ \\w+x', '(?:ab)+c', '[a-z]+\\d+x', 'a?b?c?d?e?x'];
  const hostile = ['foo'.repeat(30), 'ab'.repeat(30), '#'.repeat(30), 'a'.repeat(30), 'abcde'.repeat(10)];
  for (const pattern of accepted) {
    assert.equal(backtrackingRisk(pattern), null, pattern);
    const regex = new RegExp(pattern, FLAGS);
    const start = process.hrtime.bigint();
    for (const text of hostile) regex.test(text);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 200, `${pattern} took ${ms} ms`);
  }
});

// --- Purity -----------------------------------------------------------------------------------

test('pattern-syntax.js requires no module at all', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pattern-syntax.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(source, /\brequire\s*\(/);
  assert.doesNotMatch(source, /\b(fetch|eval)\s*\(|\bprocess\s*\.|\bimport\s*\(/);
});
