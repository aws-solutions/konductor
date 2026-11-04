// SPDX-License-Identifier: Apache-2.0
/**
 * Pattern Syntax
 *
 * A small parser for the regular expression sources that task checks carry, and five questions
 * answered from its tree: how few characters can a match consume (`minMatchLength`), does the
 * pattern use a lookahead or lookbehind (`hasLookaround`, finding C), is the pattern a plain run
 * of literal characters (`plainLiteral`), which short texts satisfy it (`candidateMatches`), and
 * could it take exponential time to fail on some input (`backtrackingRisk`). Checks.js uses the
 * first two to refuse patterns that match arbitrary prose (finding C-3) and lookarounds (finding
 * C), `plainLiteral` to match plain literals on word boundaries, and the last to refuse patterns
 * prone to catastrophic backtracking (finding I-1); task-lint.js uses `candidateMatches` to build
 * the texts that a pattern accepts, to compare checks and to find wording that only the skill text
 * holds; negatives.js uses `literalRuns` to judge whether a declared negative is a near miss.
 *
 * `minLiteralChars` (finding I-3 r4) counts the characters every match must contain as literal
 * text, which checks.js uses to refuse a pattern made only of character classes.
 *
 * Bounded work (finding A). `candidateMatches` spends at most MAX_WITNESS_STEPS steps per
 * candidate text, whatever the pattern. The cap on the length of the text it builds does not bound
 * the work on its own, because a quantifier around an empty body adds nothing to the text:
 * `(?:(?:(?:(?:){200}){200}){200}){200}` is a valid pattern that asks for 200^4 repetitions of
 * nothing. A step is one visit to a node of the pattern tree, so the budget bounds the time that
 * the length cap never reached.
 *
 * The module is pure and dependency-free: it reads no files, spawns no processes and makes no
 * network calls. Nothing here throws; an unparsable source gives `null` (or an empty list), and
 * the caller treats that as "cannot be analyzed" and fails closed.
 *
 * Syntax. Checks compile with the flags `imu` (finding I-9), so the parser follows the unicode
 * grammar: `\u{41}` is the code point U+0041, a `\uD83D\uDE00` surrogate pair is one character,
 * `\p{L}` is a property class that matches one letter, and a literal `{`, `}` or `]`, or an
 * identity escape of a character that is not a syntax character (`\-`, `\_`), does not compile.
 * A source must already compile with `u` before it is parsed; the parser assumes that and fails
 * closed on anything it does not recognize. It still reads a stray `{` as a literal, which only
 * matters for a source that cannot compile. Back references are counted as consuming nothing,
 * which can only make a pattern look shorter and so errs toward rejecting it.
 */

/** Largest repeat count the witness builder will expand, and longest text it will build. */
const MAX_REPEAT = 200;
const MAX_WITNESS_LENGTH = 5000;
/**
 * A: most tree nodes the witness builder may visit while building one candidate text. A pattern of
 * at most 500 characters that builds a legitimate candidate visits a few hundred nodes; the
 * budget leaves two orders of magnitude of room and stops an empty-body quantifier (which adds no
 * text, so MAX_WITNESS_LENGTH never trips) from running for 200^4 visits.
 */
const MAX_WITNESS_STEPS = 20000;
/** Alternation branches the witness builder tries, one candidate text per branch index. */
const BRANCH_VARIANTS = 4;
/** What `.` becomes in a candidate text. */
const ANY_MEMBER = 'a';

/**
 * I-1: the largest repeat count that still counts as small when a repeat is nested around a
 * variable-length part, and the most variable quantifiers one pattern may hold.
 */
const MAX_SMALL_NEST = 4;
const MAX_VARIABLE_QUANTIFIERS = 10;
/**
 * I-1: a variable quantifier whose upper bound exceeds WIDE_REPEAT (`*`, `+`, `{2,}`, `{1,100}`) is
 * wide, and a pattern may hold at most MAX_WIDE_QUANTIFIERS of them. Three wide quantifiers took 63
 * seconds on 1,000 characters (`a*a*a*b` against `a` repeated), two took 0.2 seconds. The cap keeps
 * the text validation itself runs, a declared negative, far inside the execution time limit.
 */
const WIDE_REPEAT = 16;
const MAX_WIDE_QUANTIFIERS = 2;

/** Characters tried, in order, when a class or escape needs one concrete member. */
const CANDIDATE_ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:!?-_/\'"()[]{}<>@#$%&*+=~`|\\^\n\t';

const CONTROL_ESCAPES = { n: '\n', r: '\r', t: '\t', f: '\f', v: '\v', 0: '\0' };

class Unsupported extends Error {}

function fail() {
  throw new Unsupported('unsupported pattern syntax');
}

function parseTree(source) {
  let i = 0;
  let groupCount = 0;
  const names = new Map();

  function alternation() {
    const branches = [sequence()];
    while (source[i] === '|') {
      i += 1;
      branches.push(sequence());
    }
    return branches.length === 1 ? branches[0] : { t: 'alt', branches };
  }

  function sequence() {
    const items = [];
    while (i < source.length && source[i] !== '|' && source[i] !== ')') items.push(term());
    return { t: 'seq', items };
  }

  function term() {
    const node = atom();
    const quantifier = readQuantifier();
    return quantifier ? { t: 'quant', min: quantifier.min, max: quantifier.max, node } : node;
  }

  function readQuantifier() {
    const c = source[i];
    let found = null;
    if (c === '*') found = { min: 0, max: Infinity, length: 1 };
    else if (c === '+') found = { min: 1, max: Infinity, length: 1 };
    else if (c === '?') found = { min: 0, max: 1, length: 1 };
    else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i, i + 40));
      if (m) {
        const min = Number(m[1]);
        let max = min;
        if (m[2] !== undefined) max = m[3] === '' ? Infinity : Number(m[3]);
        found = { min, max, length: m[0].length };
      }
    }
    if (!found) return null;
    i += found.length;
    if (source[i] === '?') i += 1; // lazy suffix; laziness does not change what can match
    return found;
  }

  function atom() {
    const c = source[i];
    if (c === '(') return group();
    if (c === '[') return charClass();
    if (c === '\\') return escape();
    if (c === '.') {
      i += 1;
      return { t: 'any' };
    }
    if (c === '^' || c === '$') {
      i += 1;
      return { t: 'assert', kind: c };
    }
    if (c === '*' || c === '+' || c === '?') fail(); // a quantifier with nothing to repeat does not compile
    const value = String.fromCodePoint(source.codePointAt(i));
    i += value.length;
    return { t: 'char', value };
  }

  function group() {
    i += 1;
    let node = { t: 'group', capture: true, index: 0 };
    if (source[i] === '?') {
      if (source.startsWith('?:', i)) {
        i += 2;
        node = { t: 'group', capture: false, index: 0 };
      } else if (source.startsWith('?=', i) || source.startsWith('?!', i)) {
        node = { t: 'look', ahead: true, negate: source[i + 1] === '!' };
        i += 2;
      } else if (source.startsWith('?<=', i) || source.startsWith('?<!', i)) {
        node = { t: 'look', ahead: false, negate: source[i + 2] === '!' };
        i += 3;
      } else if (source.startsWith('?<', i)) {
        const end = source.indexOf('>', i);
        if (end < 0) fail();
        node.name = source.slice(i + 2, end);
        i = end + 1;
      } else {
        fail();
      }
    }
    if (node.t === 'group' && node.capture) {
      groupCount += 1;
      node.index = groupCount;
      if (node.name !== undefined) names.set(node.name, node.index);
    }
    node.node = alternation();
    if (source[i] !== ')') fail();
    i += 1;
    return node;
  }

  function charClass() {
    const start = i;
    i += 1;
    if (source[i] === '^') i += 1;
    while (i < source.length && source[i] !== ']') i += source[i] === '\\' ? 2 : 1;
    if (i >= source.length) fail();
    i += 1;
    return { t: 'class', source: source.slice(start, i) };
  }

  function escape() {
    const next = source[i + 1];
    if (next === undefined) fail();
    const rest = source.slice(i, i + 12);
    if (next === 'b' || next === 'B') {
      i += 2;
      return { t: 'assert', kind: next };
    }
    if (/[1-9]/.test(next)) {
      const m = /^\\([1-9]\d*)/.exec(rest);
      i += m[0].length;
      return { t: 'backref', index: Number(m[1]) };
    }
    if (next === 'k' && source[i + 2] === '<') {
      const end = source.indexOf('>', i);
      if (end < 0) fail();
      const name = source.slice(i + 3, end);
      i = end + 1;
      return { t: 'backref', name };
    }
    // I-9: with the `u` flag `\u{...}` is one code point and a surrogate pair written as two `\u`
    // escapes is one character; without it the first was `u` repeated and the second two characters.
    const braced = next === 'u' ? /^\\u\{([0-9a-fA-F]+)\}/.exec(source.slice(i, i + 16)) : null;
    if (braced) {
      const codePoint = parseInt(braced[1], 16);
      if (codePoint > 0x10ffff) fail();
      i += braced[0].length;
      return { t: 'char', value: String.fromCodePoint(codePoint), escaped: true };
    }
    const hex = next === 'u' ? /^\\u([0-9a-fA-F]{4})/.exec(rest) : next === 'x' ? /^\\x([0-9a-fA-F]{2})/.exec(rest) : null;
    if (hex) {
      i += hex[0].length;
      let value = String.fromCharCode(parseInt(hex[1], 16));
      const low = next === 'u' && /[\ud800-\udbff]/.test(value) ? /^\\u(d[c-f][0-9a-f]{2})/i.exec(source.slice(i, i + 6)) : null;
      if (low) {
        i += low[0].length;
        value += String.fromCharCode(parseInt(low[1], 16));
      }
      return { t: 'char', value, escaped: true };
    }
    if (next === 'p' || next === 'P') {
      // I-9: a Unicode property class such as `\p{L}`; it matches one character like `\w` does.
      const property = /^\\[pP]\{[^}]*\}/.exec(source.slice(i, i + 80));
      if (!property) fail();
      i += property[0].length;
      return { t: 'esc', source: property[0] };
    }
    if (next === 'c' && /[A-Za-z]/.test(source[i + 2] || '')) {
      i += 3;
      return { t: 'char', value: String.fromCharCode(source.charCodeAt(i - 1) % 32), escaped: true };
    }
    if ('dDsSwW'.includes(next)) {
      i += 2;
      return { t: 'esc', source: `\\${next}` };
    }
    if (Object.hasOwn(CONTROL_ESCAPES, next)) {
      i += 2;
      return { t: 'char', value: CONTROL_ESCAPES[next], escaped: true };
    }
    const value = String.fromCodePoint(source.codePointAt(i + 1));
    i += 1 + value.length;
    return { t: 'char', value, escaped: true };
  }

  const tree = alternation();
  if (i !== source.length) fail();
  return { tree, names };
}

/** Parses `source`. Returns `{ tree, names }`, or null when the source cannot be analyzed. */
function parsePattern(source) {
  try {
    if (typeof source !== 'string') return null;
    return parseTree(source);
  } catch {
    return null;
  }
}

function minLengthOf(node) {
  switch (node.t) {
    case 'seq':
      return node.items.reduce((sum, item) => sum + minLengthOf(item), 0);
    case 'alt':
      return Math.min(...node.branches.map(minLengthOf));
    case 'char':
    case 'esc':
    case 'any':
    case 'class':
      return 1;
    case 'group':
      return minLengthOf(node.node);
    case 'quant':
      return node.min * minLengthOf(node.node);
    default:
      // C-3: assertions, lookarounds and back references consume nothing. A lookaround's own text
      // is deliberately not counted: it is how `t(?=h)` looked selective while matching prose.
      return 0;
  }
}

/**
 * The fewest characters any match of `source` consumes, or null when the source cannot be
 * analyzed. Anchors, word boundaries, lookarounds and back references count as zero.
 */
function minMatchLength(source) {
  const parsed = parsePattern(source);
  return parsed === null ? null : minLengthOf(parsed.tree);
}

/** I-3 r4: the fewest characters written out literally in any match of `node`. */
function literalLengthOf(node) {
  switch (node.t) {
    case 'seq':
      return node.items.reduce((sum, item) => sum + literalLengthOf(item), 0);
    case 'alt':
      return Math.min(...node.branches.map(literalLengthOf));
    case 'char':
      return 1;
    case 'group':
      return literalLengthOf(node.node);
    case 'quant':
      return node.min * literalLengthOf(node.node);
    default:
      // Classes (`\w`, `[a-z]`, `\p{L}`), the wildcard, assertions, lookarounds and back references
      // write no text of their own: whatever they match, the pattern did not name it.
      return 0;
  }
}

/**
 * I-3 r4: the fewest characters that every match of `source` contains as literal text (written out
 * in the pattern, not matched by a class), or null when the source cannot be analyzed. `\w\w\w`,
 * `[a-z]{5}` and `.+` are 0, `\d+\.\d+` is 1, `rollback \w+` is 9. An alternation counts its
 * shortest branch, an optional part counts nothing. A pattern with too few of them is made of
 * character classes and matches ordinary prose (checks.js MIN_LITERAL_CHARS).
 */
function minLiteralChars(source) {
  const parsed = parsePattern(source);
  return parsed === null ? null : literalLengthOf(parsed.tree);
}

/**
 * C: whether `source` holds a lookahead or lookbehind (`(?=`, `(?!`, `(?<=`, `(?<!`), anywhere in
 * the pattern, read from the parse tree so that an escaped `\(?=` or a class `[(?=]` is not
 * mistaken for one. Returns null when the source cannot be analyzed.
 */
function hasLookaround(source) {
  const parsed = parsePattern(source);
  if (parsed === null) return null;
  const visit = (node) => node.t === 'look' || childrenOf(node).some(visit);
  return visit(parsed.tree);
}

/**
 * When `source` is only literal characters (escaped or not), optionally between a leading `^` and
 * a trailing `$`, returns `{ text, first, last }`; otherwise null. A pattern with an alternation,
 * group, class, wildcard, class escape, quantifier or lookaround is not a plain literal.
 */
function plainLiteral(source) {
  const parsed = parsePattern(source);
  if (parsed === null || parsed.tree.t !== 'seq') return null;
  const items = [...parsed.tree.items];
  if (items.length > 0 && items[0].t === 'assert' && items[0].kind === '^') items.shift();
  if (items.length > 0 && items[items.length - 1].t === 'assert' && items[items.length - 1].kind === '$') items.pop();
  if (items.length === 0 || !items.every((item) => item.t === 'char')) return null;
  const text = items.map((item) => item.value).join('');
  const chars = Array.from(text);
  return { text, first: chars[0], last: chars[chars.length - 1] };
}

/**
 * The runs of consecutive unquantified literal characters in `source`, in order. A group, class,
 * quantifier or alternation ends a run. Returns an empty list when the source cannot be analyzed.
 */
function literalRuns(source) {
  const parsed = parsePattern(source);
  if (parsed === null) return [];
  const runs = [];
  const visit = (node) => {
    if (node.t === 'seq') {
      let run = '';
      for (const item of node.items) {
        if (item.t === 'char') {
          run += item.value;
          continue;
        }
        if (run) runs.push(run);
        run = '';
        visit(item);
      }
      if (run) runs.push(run);
    } else if (node.t === 'alt') {
      node.branches.forEach(visit);
    } else if (node.t === 'group' || node.t === 'look' || node.t === 'quant') {
      visit(node.node);
    }
  };
  visit(parsed.tree);
  return runs;
}

/** The child nodes of `node`, for walking the tree. */
function childrenOf(node) {
  if (node.t === 'seq') return node.items;
  if (node.t === 'alt') return node.branches;
  if (node.t === 'group' || node.t === 'look' || node.t === 'quant') return [node.node];
  return [];
}

/** True when the quantifier can match a varying number of repeats (`?`, `*`, `+`, `{2,5}`; not `{3}`). */
function isVariable(quant) {
  return quant.max > quant.min;
}

/**
 * The character a branch must start with, lowercased so that case folding cannot hide an
 * overlap, or null when the branch can start with more than one character or with nothing.
 */
function leadingKey(node) {
  if (node.t === 'seq') return node.items.length === 0 ? null : leadingKey(node.items[0]);
  if (node.t === 'group') return leadingKey(node.node);
  if (node.t === 'char') return node.value.toUpperCase().toLowerCase();
  return null;
}

/** The first node under `node` (excluding `node`) for which `test` holds, or null. */
function findBelow(node, test) {
  for (const child of childrenOf(node)) {
    if (test(child)) return child;
    const found = findBelow(child, test);
    if (found !== null) return found;
  }
  return null;
}

/** True when a repeat of `outer` around a variable `inner` is small enough to be harmless. */
function isSmallNest(outer, inner) {
  return Number.isFinite(outer.max) && outer.max <= MAX_SMALL_NEST && Number.isFinite(inner.max) && inner.max <= MAX_SMALL_NEST;
}

/**
 * I-1: a short reason why `source` could take exponential time to fail on some input, or null
 * when it shows none of the shapes below (and also when it cannot be parsed; the caller fails
 * closed on that separately). The rules read the tree and nothing else, so the verdict is the
 * same on every machine. They are deliberately conservative: a pattern that is safe but looks like
 * one of these shapes is rejected, and the author rewrites it. Four shapes:
 *   - a repeat around a part that can itself vary in length, such as `(\w+\s?)+` or `(a*)*`. The
 *     same text can be split between the inner and outer repeat in exponentially many ways.
 *     A repeat of at most MAX_SMALL_NEST around a range of at most MAX_SMALL_NEST, such as
 *     `(?:\d{1,3}\.){3}`, has too few splits to matter and is allowed.
 *   - a repeat around an alternation whose branches can begin with the same character, such as
 *     `(a|ab)+`, `(a|a)*` or `(a|)+`. A branch list whose first characters all differ, such as
 *     `(?:foo|bar)+`, has exactly one way to continue and is allowed.
 *   - more than MAX_VARIABLE_QUANTIFIERS variable quantifiers in all, such as thirty `a?` before
 *     thirty `a`, where the optional parts multiply.
 *   - more than MAX_WIDE_QUANTIFIERS wide quantifiers, such as `a*a*a*b`, whose reaches multiply:
 *     the cost grows with the length of the text raised to the number of them.
 * This does not bound polynomial cost (`a.*b` on a long run of `a`); checks.js runs every pattern
 * under a time limit for that.
 */
function backtrackingRisk(source) {
  const parsed = parsePattern(source);
  if (parsed === null) return null;
  let variable = 0;
  let wide = 0;
  let risk = null;
  const visit = (node) => {
    if (risk !== null) return;
    if (node.t === 'quant') {
      if (isVariable(node)) variable += 1;
      if (isVariable(node) && node.max > WIDE_REPEAT) wide += 1;
      if (node.max > 1) {
        if (findBelow(node, (child) => child.t === 'quant' && isVariable(child) && !isSmallNest(node, child)) !== null) {
          risk = 'repeats a part of itself that can vary in length (a nested quantifier such as "(a+)+"), which can take exponential time to fail on some text; use a bounded or unambiguous form';
        } else if (
          findBelow(node, (child) => {
            if (child.t !== 'alt') return false;
            const keys = child.branches.map(leadingKey);
            return keys.includes(null) || new Set(keys).size !== keys.length;
          }) !== null
        ) {
          risk = 'repeats an alternation whose branches can start with the same character (such as "(a|ab)+"), which can take exponential time to fail on some text; make the branches start with different characters';
        }
      }
    }
    childrenOf(node).forEach(visit);
  };
  visit(parsed.tree);
  if (risk === null && variable > MAX_VARIABLE_QUANTIFIERS) {
    risk = `has ${variable} optional or variable-length parts, more than the limit of ${MAX_VARIABLE_QUANTIFIERS}; their choices multiply on text that almost matches`;
  } else if (risk === null && wide > MAX_WIDE_QUANTIFIERS) {
    risk = `has ${wide} open-ended quantifiers (*, +, or a range wider than ${WIDE_REPEAT}), more than the limit of ${MAX_WIDE_QUANTIFIERS}; their costs multiply on long text that almost matches; bound some of them, for example {1,${WIDE_REPEAT}}`;
  }
  return risk;
}

/** The first member of CANDIDATE_ALPHABET that the class or escape `classSource` accepts. */
function memberOf(classSource) {
  // I-9: the same flags the check compiles with; `\p{L}` is only a class under `u`.
  const test = new RegExp(`^${classSource}$`, 'iu');
  for (const candidate of CANDIDATE_ALPHABET) if (test.test(candidate)) return candidate;
  return fail();
}

function emit(node, state) {
  // A: every visit spends a step, so work is bounded by MAX_WITNESS_STEPS even when the text built
  // stays empty. Counting the visit and not the output is what stops `(?:(?:){200}){200}`.
  state.steps += 1;
  if (state.steps > MAX_WITNESS_STEPS) fail();
  let out = '';
  switch (node.t) {
    case 'seq':
      out = node.items.map((item) => emit(item, state)).join('');
      break;
    case 'alt':
      // Every alternation in one variant takes the same branch index.
      out = emit(node.branches[state.branch % node.branches.length], state);
      break;
    case 'char':
      out = node.value;
      break;
    case 'esc':
      out = memberOf(node.source);
      break;
    case 'any':
      out = ANY_MEMBER;
      break;
    case 'class':
      out = memberOf(node.source);
      break;
    case 'group':
      out = emit(node.node, state);
      if (node.capture) state.captures.set(node.index, out);
      break;
    case 'look':
      // A positive lookaround is satisfied by the text it describes sitting next to the match.
      out = node.negate ? '' : emit(node.node, state);
      break;
    case 'backref': {
      const index = node.name === undefined ? node.index : state.names.get(node.name);
      out = state.captures.get(index) || '';
      break;
    }
    case 'quant': {
      if (node.min > MAX_REPEAT) fail();
      const count = state.plus ? Math.min(Math.max(node.min, 1), node.max) : node.min;
      for (let n = 0; n < count; n += 1) {
        out += emit(node.node, state);
        // A: stop as soon as the text is too long, not after the whole loop has built it.
        if (out.length > MAX_WITNESS_LENGTH) fail();
      }
      break;
    }
    default:
      out = ''; // assertions
  }
  if (out.length > MAX_WITNESS_LENGTH) fail();
  return out;
}

/**
 * A few short texts that satisfy `source`: one per alternation branch index, each built with the
 * fewest repeats and again with at least one. The texts are
 * guesses; the caller must run the real expression over them before relying on one, and must run
 * it with a time limit, because a candidate can still make the real expression slow (finding A).
 * Building a variant spends at most MAX_WITNESS_STEPS steps and MAX_WITNESS_LENGTH characters.
 * Returns an empty list when the source cannot be analyzed, no member of a class could be found,
 * or every variant ran out of its budget.
 */
function candidateMatches(source) {
  const parsed = parsePattern(source);
  if (parsed === null) return [];
  const found = new Set();
  for (const plus of [false, true]) {
    for (let branch = 0; branch < BRANCH_VARIANTS; branch += 1) {
      try {
        // A: each variant has its own step budget, so one that exhausts it does not starve the rest.
        found.add(emit(parsed.tree, { branch, plus, steps: 0, captures: new Map(), names: parsed.names }));
      } catch {
        // Unsupported, oversized or over budget for this variant; the other variants may still build.
      }
    }
  }
  return [...found];
}

module.exports = {
  MAX_REPEAT,
  MAX_WITNESS_STEPS,
  MAX_SMALL_NEST,
  MAX_VARIABLE_QUANTIFIERS,
  WIDE_REPEAT,
  MAX_WIDE_QUANTIFIERS,
  parsePattern,
  minMatchLength,
  hasLookaround,
  plainLiteral,
  literalRuns,
  backtrackingRisk,
  candidateMatches,
  minLiteralChars,
};
