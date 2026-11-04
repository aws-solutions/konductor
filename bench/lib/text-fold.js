// SPDX-License-Identifier: Apache-2.0
/**
 * Text fold
 *
 * The one folding that task-schema.js (rubric duplicates, rubric quoting, blank detection) and
 * negatives.js (duplicate negatives) use to decide that two strings are "the same text". It exists
 * so that the two modules cannot disagree (finding I-D). Before it, rubric items were folded with
 * accents, look-alike letters and apostrophes handled, and negatives with only compatibility forms
 * and format characters, so `rolled forward` and `rolled forward\u034f` (a combining grapheme
 * joiner) counted as two negatives while the rubric folded the same trick away, and an item of
 * `\u3164\u2800\u115f` (Hangul filler, Braille blank, Hangul choseong filler) counted as text
 * because none of those is a space, a control or a format character.
 *
 * The module is pure and dependency-free: it reads no files, spawns no processes and makes no
 * network calls. It never throws on a string.
 *
 * Stable API: `foldedText`, `foldedForm`, `isBlankText`, `withoutInvisible`.
 *
 * What the fold does, in order:
 *   - an apostrophe inside a word is ignored whatever its shape, so a curly `don’t` is the straight
 *     `don't` (I-5);
 *   - compatibility forms are folded (NFKC: `ＡＢＣ` is `abc`) and case is ignored;
 *   - accents and other combining marks are dropped (`plán` is `plan`);
 *   - every character that prints nothing is dropped, whatever its category (I-D): format
 *     characters (the zero-width space and joiners, the soft hyphen, the byte order mark), the
 *     Default_Ignorable_Code_Point set (which holds the combining grapheme joiner, the variation
 *     selectors and the Hangul fillers `\u115f \u1160 \u3164 \uffa0`), the Braille blank `\u2800`,
 *     lone surrogates, private-use and unassigned code points, and control characters that are not
 *     whitespace. A list of the characters seen so far would be one more table to keep up to date,
 *     so the categories decide; an invisible character that none of them covers is the residual;
 *   - letters of other scripts that print like a Latin letter are read as that letter, from a table
 *     (I-5); it is not the full Unicode confusables list, which is why task-schema.js also reports a
 *     word that mixes scripts;
 *   - whitespace of any kind is one space between words (`foldedForm` also trims).
 * It does not strip a trailing `ing`/`ed`/`s`; stemming belongs to the quoting comparison alone.
 */

/**
 * I-5: letters of other scripts that print like a Latin letter, mapped to that letter. NFKC folds
 * full-width and mathematical letters but leaves these alone, so `plаn` with a Cyrillic `а` used to
 * be a different word from `plan`. Keys are lower case, because the text is lower-cased first. The
 * table lists look-alikes of the Cyrillic and Greek alphabets and the Latin small capitals; it is
 * not the full Unicode confusables list, and `mixesScripts` in task-schema.js catches a word that
 * mixes scripts whatever letter was used.
 */
const CONFUSABLES = Object.freeze({
  '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y', '\u0445': 'x',
  '\u0456': 'i', '\u0458': 'j', '\u0455': 's', '\u0501': 'd', '\u04bb': 'h', '\u051b': 'q', '\u051d': 'w',
  '\u04cf': 'l', '\u043a': 'k', '\u0442': 't', '\u043d': 'h', '\u043c': 'm', '\u0432': 'b',
  '\u03bf': 'o', '\u03bd': 'v', '\u03b1': 'a', '\u03c1': 'p', '\u03b9': 'i', '\u03ba': 'k', '\u03c5': 'u',
  '\u03c7': 'x', '\u03c4': 't', '\u03b5': 'e', '\u03b7': 'n', '\u03c9': 'w', '\u03b2': 'b', '\u03b6': 'z',
  '\u03bc': 'm',
  '\u0251': 'a', '\u0261': 'g', '\u0131': 'i', '\u0269': 'i',
  '\u1d00': 'a', '\u0299': 'b', '\u1d04': 'c', '\u1d05': 'd', '\u1d07': 'e', '\u0262': 'g', '\u029c': 'h',
  '\u026a': 'i', '\u1d0a': 'j', '\u1d0b': 'k', '\u029f': 'l', '\u1d0d': 'm', '\u0274': 'n', '\u1d0f': 'o',
  '\u1d18': 'p', '\u0280': 'r', '\ua731': 's', '\u1d1b': 't', '\u1d1c': 'u', '\u1d20': 'v', '\u1d21': 'w',
  '\u028f': 'y', '\u1d22': 'z',
});
const CONFUSABLE_PATTERN = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'gu');
/** I-5: quote-like characters that stand for the apostrophe inside a word, curly ones among them. */
const APOSTROPHE_INSIDE_WORD = /(?<=\p{L})['\u2018\u2019\u201b\u02bc\u02b9\u02bb\u2032\u00b4\uff07](?=\p{L})/gu;
/**
 * I-D: characters that print nothing, dropped by category and not by list: combining marks (`\p{M}`,
 * which holds U+034F and the variation selectors), format characters, lone surrogates, private-use
 * and unassigned code points, the Default_Ignorable_Code_Point set (the Hangul fillers) and the
 * Braille blank, which is a symbol and in none of the others.
 */
const INVISIBLE_PATTERN = /[\p{M}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Default_Ignorable_Code_Point}\u2800]/gu;

/**
 * The fold described in the header. The result is lower case and holds single spaces between
 * words, though it is not trimmed; `foldedForm` trims.
 */
function foldedText(text) {
  return text
    .replace(APOSTROPHE_INSIDE_WORD, '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFKD')
    .replace(INVISIBLE_PATTERN, '')
    .replace(CONFUSABLE_PATTERN, (letter) => CONFUSABLES[letter])
    .replace(APOSTROPHE_INSIDE_WORD, '')
    .replace(/[\s\p{Z}]+/gu, ' ')
    .replace(/\p{Cc}/gu, '');
}

/**
 * I-D: `text` in NFKC form with the characters that print nothing dropped and nothing else
 * changed, for callers that need the letters as written (task-schema.js `mixesScripts`) but must
 * not be split by an invisible character into two words that each look single-script.
 */
function withoutInvisible(text) {
  return text.normalize('NFKC').replace(INVISIBLE_PATTERN, '');
}

/** The form in which two strings count as the same text: `foldedText`, trimmed. */
function foldedForm(text) {
  return foldedText(text).trim();
}

/** I-D: true when `text` holds nothing a reader could see once the fold has dropped what prints nothing. */
function isBlankText(text) {
  return foldedForm(text) === '';
}

module.exports = { foldedText, foldedForm, isBlankText, withoutInvisible };
