// SPDX-License-Identifier: Apache-2.0
/**
 * Snapshot Loader
 *
 * Reads a directory tree into the workspace snapshot that checks.js evaluates: a plain object
 * from relative path (forward slashes) to file content as a string. This is the only module of
 * the task validation layer that touches the filesystem, so the matcher itself stays pure and a
 * stored snapshot replays offline. It starts no processes and makes no network calls.
 *
 * Stable API: `loadSnapshot`. `decodeLossless`, `sensitiveContentReason` and `contentDigest` are
 * helpers exposed for tests and for task authors.
 *
 * What is read. Regular files only. Symbolic links are skipped and never followed, so a link
 * cannot pull in a file from outside the root. Sockets, pipes and other special files are
 * skipped. Entries named in SKIPPED_DIRECTORIES are not read, whatever their type (I-8): `.git` is
 * a directory in a clone and a one-line file in a worktree or submodule, and the file holds a
 * path on the developer's machine. Entries are visited in sorted order, so the snapshot's key
 * order does not depend on the platform.
 *
 * Skipped entries leave a marker (finding I-A). A skipped entry is not read, but it is not
 * invisible either: the snapshot gets a key for its path (`src/node_modules`, `.git`) whose value
 * is always the empty string. The marker records that something is there without recording what.
 * Without it a subject could add `src/node_modules/evil.js` and `fixture_unchanged` on `src` would
 * report "identical", and `file_absent` on a path under `src/.git` could never fail. checks.js
 * counts a marker as an entry under its parent (so it is an addition for `fixture_unchanged` and
 * makes a directory non-empty for `file_absent`), refuses to call a directory unchanged when its
 * pristine side holds one, and rejects any check whose own path runs through a skipped name. A
 * marker is never a file: no check can name one, and its value says nothing about the entry.
 *
 * Sensitive files (findings I-8 and C-6). A snapshot can end up in a report or in a prompt sent to a model
 * provider, so the loader never ingests credentials. It refuses in two layers, and throws instead
 * of skipping so that a secret in the workspace is seen and not silently left out:
 *   - by name: a path that `sensitivePathReason` (safe-path.js) flags, such as `.env`,
 *     `.aws/credentials`, `.cargo/credentials.toml`, `gcp-key.json`, `.ssh/id_rsa` or
 *     `server.pem`, is refused before it is opened;
 *   - by content: a file whose text matches one of four groups of rules is refused whatever it is
 *     called. (1) Named formats: private key blocks and service-account key files, AWS key ids and
 *     secret key fields, and the tokens of GitHub, GitLab, Slack, Stripe, npm, SendGrid, Hugging
 *     Face, Google and a score of other providers, plus JWTs and bearer tokens. (2) Secret-looking
 *     assignments: a key whose name ends in password, passwd, passphrase, passcode, pass, pw, pwd,
 *     secret, token, api key, access key, private key or credential, given a literal value of six
 *     or more characters that holds a digit (`password=...`, `"token": "..."`, `npmAuthToken: ...`);
 *     after `pass` or `pw`, which are also words, the value must hold a letter too. A value is
 *     exempt only when the whole of it is a reference or a template (`${VAR}`, `$VAR`, `%VAR%`,
 *     `{{ var }}`, `<placeholder>`, `%(name)s`, `***`) or a call, an index path or a pattern in code.
 *     Starting with `$`, `@` or `*`, or holding a bracket, does not exempt it. (3) Connection strings
 *     that carry a password (`scheme://user:password@host`). (4) High-entropy tokens: a run of 32
 *     to 256 base64-alphabet characters anywhere in the text, in a table cell, a list item, a CSV
 *     field, a URL path or a sentence as much as after `=` or in quotes. It needs a digit and a
 *     letter, and scores at ENTROPY_THRESHOLD bits per character or more (ENTROPY_THRESHOLD_ONE_CASE
 *     when it has one letter case only, with no separator and not hex). Not counted: a PEM block
 *     whose body is genuine DER or a PGP armor with a matching CRC-24, an integrity hash that has
 *     the exact length and padding of its algorithm, a payload after `data:...;base64,`, a run that
 *     is half or more consecutive characters such as an alphabet, and the words, numbers, hex groups
 *     and CamelCase names of a run that is mostly those.
 * What this claims, and what it does not (C-6). It claims that a file matching a rule is refused.
 * It does not claim that a file matching none holds no credential: a denylist cannot be complete,
 * and groups (2) to (4) bound the gap without closing it. The slip figures below are measured: 100000
 * random tokens per length and alphabet (base64, base64url, alphanumeric, lower case and digits, upper
 * case and digits), each placed in quotes, in a table cell and in a sentence; the three placements agree
 * within 0.2 points, and a test pins them (snapshot-loader-credentials-r4.test.js). Known misses:
 * a password with no digit in it, a password of digits only after `pass` or `pw`, a quoted password
 * with a space in it, a secret in a name the keyword list does not contain, a token under 32
 * characters from a provider not named, a token over 256 characters, a hex secret outside an
 * assignment (hex stays under the entropy threshold), a token of letters only, a secret that is
 * encoded, compressed, split over lines or cut into pieces under 32 characters by more words than
 * it has characters (`part1-community-support-forum-contributions-guidelines-part2`), anything binary, a 64-byte secret written as a genuine
 * `sha512-...==` digest (it cannot be told from one), a token behind a `data:...;base64,` prefix, a
 * token that is half or more consecutive characters, and the share of random tokens that score
 * under the bar by chance: 4.0% to 4.6% of random 32-character tokens (base64url 4.0%, alphanumeric
 * 4.5%, one case and digits 4.3%), 0.8% to 1.1% at 36, 0.2% to 0.4% at 40, and under 0.4% at 44, with
 * one case and digits reaching 0.6% at 64. Lengths 32 to 39 are the weak spot of the rule. Known
 * false positives: a random-looking identifier or id in
 * documentation (an S3 version id, an SSM parameter path), a URL with a random path segment
 * (a font file on a CDN), a connection string in documentation whose password is not an obvious
 * placeholder, and a test fixture that holds a fake key; the cure for those is `allowSensitive`
 * below. Run over the 624 tracked files of this repository, the scan refuses 4, all of which quote
 * credential formats on purpose: this file, snapshot-loader-credentials.test.js,
 * snapshot-loader-soundness.test.js and trace-normalizer.test.js. The loader is a backstop, not a
 * licence to point it at a home directory; the workspace root should be a task workspace. The error
 * names the path and the rule, never the matched text.
 *
 * Allowing a path (C-6). A task that legitimately needs a file the name layer flags lists it in
 * `options.allowSensitive`. A bare string is an exact relative path: the name layer is skipped for
 * it, and its content is still scanned in full, so a real secret written at an allowed path is
 * refused. To admit a fixture whose content the scan would refuse, such as a fake key in a test
 * file, list `{ path, sha256 }`, where `sha256` is `contentDigest(bytes)` of the pristine fixture.
 * The content scan is skipped only while the bytes read hash to that digest, so the allowance
 * covers the fixture and nothing a subject writes there later; any other content at the path is
 * scanned like any other file. No pattern or directory prefix is accepted in either form. The
 * digest was chosen over "allow the path and rescan only what changed" because the loader holds no
 * pristine snapshot to compare with, and a digest in the task definition needs none.
 *
 * Descending the tree (finding I-H). `O_NOFOLLOW` guards only the last component of a path, so a
 * directory swapped for a symbolic link between listing it and reading it would be followed, and
 * the files read from outside the root would pass the name rule, which never saw their real path.
 * The loader therefore does not re-resolve paths by name. On Linux each directory is opened with
 * `O_DIRECTORY | O_NOFOLLOW` and its children are opened through `/proc/self/fd/<fd>/<name>`, so
 * the kernel resolves them against the directory it already holds and no ancestor is looked up
 * again. On macOS the root is resolved once with `realpath` and every open carries `O_NOFOLLOW_ANY`,
 * which makes the kernel refuse a symbolic link in any component of the path at the moment of the
 * open; a directory listing there is checked against the identity (device and inode) of the
 * descriptor it came from. Any entry that was listed as a directory or a file and cannot be opened
 * as one is an error, not a skip: a workspace that changes while it is being read is not read. On
 * any other platform, or on Linux without `/proc`, the loader refuses to run, because it cannot
 * show the descent is safe; it does not fall back to path-by-path reads.
 *
 * Contents. A file is decoded as UTF-8 without loss (I-7): bytes that are not valid UTF-8 become
 * the lone surrogates U+DC80 to U+DCFF, one per byte. Valid UTF-8 can never decode to a lone
 * surrogate, so two files hold the same string only if they hold the same bytes, and
 * `fixture_unchanged` cannot be fooled by a change from one invalid byte to another. A byte order
 * mark is kept.
 *
 * Limits. A tree with more than `maxFiles` files, a file larger than `maxFileBytes`, or more
 * than `maxTotalBytes` of content in all, is an error, so a stray large directory cannot exhaust
 * memory. The limits are enforced on the bytes actually read from an open handle, never on a size
 * reported earlier by `stat` (I-8): a file that grows between the two calls is still stopped.
 * Options that are not recognised, or limits that are not non-negative integers, throw a
 * TypeError instead of falling back to a default (I-8). Unlike the matcher, the loader throws: a
 * missing directory or an unreadable file is a caller problem, not task data.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { sensitivePathReason, isSkippedName, SKIPPED_DIRECTORIES } = require('./safe-path');

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 2000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
});

/** I-8: bytes requested from the handle per read. */
const CHUNK_BYTES = 64 * 1024;

const OPTION_NAMES = Object.freeze([...Object.keys(DEFAULT_LIMITS), 'allowSensitive']);

/** I-H: Darwin's `O_NOFOLLOW_ANY`, which Node does not export. The kernel refuses a link in any path component. */
const DARWIN_O_NOFOLLOW_ANY = 0x20000000;
/** I-H: where Linux exposes a descriptor as a path that the kernel resolves against that descriptor. */
const LINUX_FD_DIRECTORY = '/proc/self/fd';

// C-6: content that is a credential whatever the file is called. Group 1 of 4: named formats.
// Every pattern is linear in the text: no nested quantifier, no unbounded repeat that can fail after
// consuming, so a hostile file cannot make the scan slow. The reasons name the rule and never the match.
const SENSITIVE_CONTENT = Object.freeze([
  { reason: 'a private key block', pattern: /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/ },
  // C-6: a Google Cloud service-account key file, even when the key body was cut out of the sample.
  { reason: 'a cloud service-account key', pattern: /"type"\s*:\s*"service_account"|"private_key(?:_id)?"\s*:\s*"/ },
  { reason: 'an AWS access key id', pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA|ACCA)[0-9A-Z]{16}\b/ },
  // C-6: also the JSON field of `aws sts` and `aws iam create-access-key` output (`"SecretAccessKey":`).
  { reason: 'an AWS secret access key field', pattern: /secret_?access_?key["']?\s*[=:]/i },
  { reason: 'a GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/ },
  // C-6: GitLab personal, trigger, deploy, runner, OAuth, SCIM, incoming-mail, agent, CI build and feed tokens.
  { reason: 'a GitLab token', pattern: /\bgl(?:pat|ptt|dt|rt|oas|soat|imt|agent|cbt|ft)-[A-Za-z0-9_-]{16,}/ },
  { reason: 'a Slack token', pattern: /\b(?:xox[abprs]-[A-Za-z0-9-]{10,}|xapp-\d-[A-Za-z0-9-]{10,})/ },
  { reason: 'a Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { reason: 'a Google OAuth token or client secret', pattern: /\b(?:ya29\.[0-9A-Za-z_-]{20,}|GOCSPX-[0-9A-Za-z_-]{20,})/ },
  // C-6: this was `sk-` only, so `sk_live_` (Stripe's underscore form) went through.
  { reason: 'an API secret key', pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}/ },
  { reason: 'a Stripe key or webhook secret', pattern: /\b(?:[sr]k_(?:live|test)_[0-9A-Za-z]{10,}|whsec_[0-9A-Za-z]{24,})/ },
  // C-6: `npm_` automation and publish tokens, and the credential lines of `.npmrc` and `.yarnrc.yml`.
  // A value that starts with `$` is an environment reference, not a secret.
  { reason: 'an npm token', pattern: /\bnpm_[A-Za-z0-9]{30,}/ },
  { reason: 'an npm registry credential', pattern: /(?<![A-Za-z0-9])_(?:authToken|auth|password)["']?\s*=\s*["']?(?![$"'\s])\S/ },
  { reason: 'a Yarn registry credential', pattern: /\bnpmAuth(?:Token|Ident)["']?\s*:\s*["']?(?![$"'\s])\S/ },
  { reason: 'a SendGrid key', pattern: /\bSG\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/ },
  { reason: 'a Hugging Face token', pattern: /\bhf_[A-Za-z0-9]{20,}/ },
  // C-6: a JWT (header and payload, or the header alone as in a pasted `Bearer`), and any bearer token with a digit.
  { reason: 'a JSON Web Token', pattern: /\beyJ[A-Za-z0-9_-]{16,}/ },
  { reason: 'a bearer token', pattern: /\bBearer\s+(?=[A-Za-z0-9._~+/=-]{0,512}\d)[A-Za-z0-9._~+/=-]{20,}/i },
  // The lookahead wants a digit: real credentials have one, and `Bearer secret-token-value` in a doc string does not.
  { reason: 'an Authorization header credential', pattern: /authorization["']?\s*[:=]\s*["']?(?:basic|bearer|token)\s+(?=[A-Za-z0-9+/=._~-]{0,256}\d)[A-Za-z0-9+/=._~-]{12,}/i },
  { reason: 'an Azure storage or service bus key', pattern: /\b(?:AccountKey|SharedAccessKey)=[A-Za-z0-9+/=]{16,}/ },
  { reason: 'a Twilio API key', pattern: /\bSK[0-9a-f]{32}\b/ },
  { reason: 'a Docker Hub token', pattern: /\bdckr_pat_[A-Za-z0-9_-]{20,}/ },
  { reason: 'a PyPI token', pattern: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{20,}/ },
  { reason: 'a DigitalOcean token', pattern: /\bdo[opr]_v1_[a-f0-9]{40,}/ },
  { reason: 'a Shopify token', pattern: /\bshp(?:at|ca|pa|ss)_[a-f0-9]{32}/ },
  { reason: 'a Databricks token', pattern: /\bdapi[a-f0-9]{32}/ },
  { reason: 'a Mailgun key', pattern: /\bkey-[0-9a-f]{32}\b/ },
  { reason: 'a Telegram bot token', pattern: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/ },
  { reason: 'a HashiCorp Vault token', pattern: /\bhv[sbr]\.[A-Za-z0-9_-]{24,}/ },
  { reason: 'an Atlassian API token', pattern: /\bATATT3[A-Za-z0-9_=-]{20,}/ },
  { reason: 'a Square token', pattern: /\bsq0(?:atp|csp)-[A-Za-z0-9_-]{22,}/ },
  { reason: 'a Pulumi token', pattern: /\bpul-[a-f0-9]{40}\b/ },
  { reason: 'a Linear API key', pattern: /\blin_api_[A-Za-z0-9]{30,}/ },
]);

// C-6: group 2 of 4, secret-looking assignments. A name that ends in one of these words, given a
// literal value. Found by a linear scan for the word and a separator, then judged in code, so a
// hostile file cannot make the pattern backtrack.
// C-2 r4: `pass`, `pw` and `passcode` are keywords, and `api key` / `access key` / `private key` may be
// written with a space, as the module header says. A bare `pass` and `pw` match prose (`Pass: 90-100`,
// `SkillResourcePass::rewrite`), so they carry a stricter value test (BARE_KEYWORD, looksLikeSecretValue).
const SECRET_KEYWORD = /(pass(?:[_-]?(?:word|wd|phrase|code))?|pw|pwd|secret|token|api[ _-]?key|apikey|access[ _-]?key|private[ _-]?key|credential)s?["']?[ \t]*[:=]/gi;
/** C-2 r4: the two keywords that are also ordinary words or abbreviations in prose. */
const BARE_KEYWORD = /^(?:pass|pw)$/i;
/** C-6: longest literal value examined; a longer one is a blob, not a password. */
const MAX_ASSIGNED_VALUE = 256;
const MIN_ASSIGNED_VALUE = 6;
// C-2 r4: a value is a reference only when the WHOLE value has one of these shapes. It used to be
// "starts with `$ % < { [ @ *`", and a strong password often starts with `$`, `@` or `*`
// (`$uperS3cret!`, `@dm1nPassw0rd`, `*Pr0dRootPw`), which loaded without a word.
/** C-6: `***` and `xxxx` and `...`: masked or elided, not a value. */
const MASKED_VALUE = /^(?:\*+|x{4,}|\.{3,})$/i;
/** C-2 r4: `${VAR}` and `${VAR:-}`; a default that holds text (`${VAR:-hunter2}`) is a literal and is not a reference. */
const DOLLAR_BRACE_REFERENCE = /^\$\{[A-Za-z_][A-Za-z0-9_.]*(?::?[-?+=])?\}$/;
/** C-2 r4: `{{ var }}`, `${{ secrets.X }}` (Jinja, Go templates, GitHub Actions), `$(cmd)` and `{var}` (`str.format`). */
const TEMPLATE_REFERENCE = /^(?:\$?\{\{[^{}]*\}\}|\$\([^()\s]*\)|\{[A-Za-z_][A-Za-z0-9_.]*\})$/;
/** C-2 r4: `%(name)s` and `%s` (Python and C format strings). */
const FORMAT_REFERENCE = /^%(?:\([A-Za-z_][A-Za-z0-9_.]*\))?[sd]$/;
/** C-2 r4: `<placeholder>`, `<your-api-key>`, `<TOKEN>`: the whole value in angle brackets, led by a letter. */
const ANGLE_PLACEHOLDER = /^<[A-Za-z][A-Za-z0-9_ .:-]*>$/;
/** C-2 r4: `$VAR` and `%VAR%`. */
const VARIABLE_REFERENCE = /^(?:\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_.]*%)$/;
/** C-6: a chain of identifiers (`req.body.token2`) is code reading a value, not a literal. */
const IDENTIFIER_CHAIN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;
// C-2 r4: a call or an index on a name that has no digit in it (`getToken(opts2)`, `sys.argv[1]`, `tokens[0]`). It
// used to be "contains any bracket, paren or angle bracket", which exempted `P@ssw0rd(1)` and `api_key = "k9<x2f>Qz7"`.
// The name must start lower case and the brackets must close the value, so `P@ssw0rd(1)` is not code.
const CODE_EXPRESSION = /^([a-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\[[^\]\s]{0,32}\]|\([^)\s]{0,32}\))+$/;
/** C-2 r4: a JMESPath or JSONPath member path with an index (`Jobs[-1].JobId`, `StreamNames[-1]`), as in botocore paginator files. */
const INDEX_PATH = /^[A-Za-z_][A-Za-z_.]*(?:\[(?:-?\d{1,3}|\*)\](?:\.[A-Za-z_][A-Za-z_]*)*)+$/;
/** C-2 r4: the start of a call or an index on a name with no digit in it: `getToken(`, `opts.tokens[`. */
const CALL_PREFIX = /^[a-z_$][A-Za-z_$.]*[([]/;
// C-2 r4: grammar and pattern notation, which the old "contains a bracket" exemption hid: an ABNF repeat
// (`token = 1*<any CHAR except CTLs>`, RFC 7230) and a regex literal (`TOKENS = /^[\u0009-\u007E]+$/`).
const ABNF_REPEAT = /^(?:\d+\*\d*[<([A-Za-z]|\*[<([])/;
const REGEX_LITERAL = /^\/(?:\^|\(\?|\[).*\/[a-z]*$/;

// C-6: group 3 of 4, a connection string that carries a password: `scheme://user:password@host`.
// Brackets are excluded from both parts so a syntax summary like `[user[:pass]@]host` is not a URL.
// The user part may be empty: Redis writes `redis://:password@host`.
const CONNECTION_STRING = /:\/\/([^\s:/@'"<>[\]{}]{0,64}):([^\s/@'"<>[\]{}]{3,128})@/g;
/** C-6: passwords that are documentation placeholders and not credentials. */
// C-2 r4: the last alternative was `[$%{].*`, which exempted any password that starts with `$` or `%`
// (`%40dm1n`, a URL-encoded `@dm1n`). A variable reference is judged by isVariableReference, case-sensitively.
const PLACEHOLDER_PASSWORD = /^(?:pass(?:word|wd)?|pwd|secret|changeme|your[-_]?password|[*x]+|\.+)$/i;

// C-6: group 4 of 4, the backstop for a provider no rule names. A run of ENTROPY_MIN_LENGTH to
// ENTROPY_MAX_LENGTH base64-alphabet characters with a digit and a letter, at or above ENTROPY_THRESHOLD
// bits per character. Measured: camelCase and snake_case identifiers and file paths of 40 to 55
// characters score 4.0 to 4.2, UUIDs and 40-digit hex 3.7. Hex tokens sit under the threshold by
// construction (16 symbols cannot reach 4.3 bits) and are caught only by group 2.
// C-2 r4: the rule used to look only at a run that followed a quote, `=` or `:`, or that stood alone on
// its line, so a 40-character AWS secret in a markdown table cell, after `secret is`, in a list item, a
// CSV field or a URL path loaded. Every maximal run is now judged wherever it sits, because a table cell,
// a list item and a CSV field are structured positions, not prose, and so is a sentence that says "the key is".
// A 32-character token is the weak spot of the rule: it scores under the bar by chance about 4% of the time.
const ENTROPY_RUN = /[A-Za-z0-9+/_=-]{32,}/g;
const ENTROPY_MIN_LENGTH = 32;
const ENTROPY_MAX_LENGTH = 256;
const ENTROPY_THRESHOLD = 4.3;
/** I-8 r4: the bar for a token of one letter case and digits, whose alphabet holds 36 symbols and whose entropy runs lower. */
const ENTROPY_THRESHOLD_ONE_CASE = 4.0;
/** C-6: a run this long of consecutive character codes (`abcdefgh`, `01234567`) is an alphabet or a counter, not key material. */
const SEQUENTIAL_RUN = 6;
// I-8 r4: the exemption for an integrity hash was "starts with `sha512-`", so any secret written as
// `sha512-<secret>` loaded. It now holds only when what follows is exactly one digest of that algorithm in
// base64, with the right length and padding (sha512: 86 characters and `==`; sha256: 43 and `=`).
const INTEGRITY_PREFIX = /^(sha(?:1|224|256|384|512))-/i;
const INTEGRITY_DIGEST = Object.freeze({
  sha1: /^[A-Za-z0-9+/]{27}=$/,
  sha224: /^[A-Za-z0-9+/]{38}==$/,
  sha256: /^[A-Za-z0-9+/]{43}=$/,
  sha384: /^[A-Za-z0-9+/]{64}$/,
  sha512: /^[A-Za-z0-9+/]{86}==$/,
});
/**
 * I-8 r4: a token of one letter case and digits only is judged too. Hex (a digest, a commit id, a UUID without
 * dashes) is not: a run of hex digits is a HEX_GROUP segment, which residuePieces cuts out before any scoring.
 */
const PLAIN_ALPHANUMERIC = /^[A-Za-z0-9]+$/;
const LONG_LETTER_RUN = /[A-Za-z]{24}/;
const EDGE_DELIMITERS = /^[-_/=+]+|[-_/=+]+$/g;
/** C-2 r4: a word inside a CamelCase identifier: a capital and four or more lower-case letters, or a lower-case word at the start. */
const IDENTIFIER_WORD = /[A-Z]?[a-z]{5,}/g;
/** C-2 r4: letters laid out like a word: no more than three consonants in a row (`Encryption`, `Strengths`). */
const WORD_SHAPE = /^(?:[^aeiouy]{0,3}[aeiouy])+[^aeiouy]{0,3}$/i;
/** C-2 r4: what a base64 data URI looks like just before its payload (`data:image/png;base64,`). The payload is an image or a font, not a secret. */
const DATA_URI_BEFORE = /data:[A-Za-z0-9.+/-]{1,60};base64,$/;
/** C-2 r4: a segment that is a word: three or more lower-case letters, a Capitalized word, or three or more capitals. */
const WORD_SEGMENT = /^(?:[a-z]{3,}|[A-Z][a-z]{2,}|[A-Z]{3,})$/;
/** C-2 r4: four or more hex digits (a UUID part, a short commit id) and up to twelve letters glued to 32 or more (`example76bd...`, `sha256` digests labelled in JSON). */
const HEX_GROUP = /^[0-9a-fA-F]{4,}$/;
const LABELLED_HEX = /^[A-Za-z]{1,12}[0-9a-fA-F]{32,}$/;

/** C-6: Shannon entropy of `token` in bits per character. */
function shannonEntropy(token) {
  const counts = new Map();
  for (const char of token) counts.set(char, (counts.get(char) || 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / token.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * C-2 r4: whether one delimiter-free `segment` of a run is structure and not key material: a word
 * (`advisories`, `Console`, `GHSA`), a group of digits, a group of four or more hex digits (a UUID part,
 * a commit id), a label glued to a hex digest (`example76bd...`), or a CamelCase identifier.
 */
function isStructuralSegment(segment) {
  return (
    WORD_SEGMENT.test(segment) ||
    /^\d+$/.test(segment) ||
    HEX_GROUP.test(segment) ||
    LABELLED_HEX.test(segment) ||
    (/[a-z]/.test(segment) && /[A-Z]/.test(segment) && segment.length >= 6 && isIdentifierLike(segment))
  );
}

/**
 * C-2 r4: the pieces of `token` that remain once its structural segments are cut out. Once every run is
 * judged wherever it sits, words joined by delimiters (`com/advisories/GHSA-9g45-5xwm-f3wc`,
 * `E2E_COGNITO_USER_POOL_ID=us-west-2_ABC123`, `Console-CreateStack-7f59c3cf-00d2-40c7-b2ff-e75db0987002`)
 * scored as random. Only what is left is judged, so `secret-token-<40 random characters>` still refuses:
 * the random part is a piece of its own. Consecutive segments that are not structure stay joined, with the
 * delimiters between them, so the AWS secret `wJalr.../K7MDENG/bPx...` is one piece.
 */
function residuePieces(token) {
  const parts = token.split(/([-_/=+]+)/);
  const pieces = [];
  let current = '';
  for (let i = 0; i < parts.length; i += 2) {
    if (isStructuralSegment(parts[i])) {
      if (current !== '') pieces.push(current);
      current = '';
    } else {
      current += parts[i] + (i + 1 < parts.length ? parts[i + 1] : '');
    }
  }
  if (current !== '') pieces.push(current);
  return pieces;
}

/**
 * I-8 r4: whether `token` is `sha512-` (or sha1, sha224, sha256, sha384) followed by exactly one digest of that
 * algorithm in base64, with the right length and padding. Only that is exempt; the prefix alone is not.
 */
function isIntegrityHash(token) {
  const integrity = INTEGRITY_PREFIX.exec(token);
  return integrity !== null && INTEGRITY_DIGEST[integrity[1].toLowerCase()].test(token.slice(integrity[0].length));
}

/**
 * C-2 r4: whether CamelCase words (`Service`, `Role`, `Channels`, or a lower-case word at the start) cover half or
 * more of a mixed-case `token`: an identifier such as `findVisualStudio2019OrNewerFromSpecified`, not key
 * material. Once every run is judged wherever it sits, long CamelCase names with a digit in them
 * (`InvalidSocks5InitialHandshake...`) reach the bar. The test is not applied to a one-case token, where
 * lower-case runs are common by chance.
 */
function isIdentifierLike(token) {
  let covered = 0;
  for (const word of token.matchAll(IDENTIFIER_WORD)) {
    // A word has no run of four consonants: `Service`, `Channels` and `Encryption` do not, `Bnrkfzx` does.
    if (WORD_SHAPE.test(word[0])) covered += word[0].length;
  }
  return covered * 5 >= token.length * 2;
}

/**
 * C-6: whether a candidate token looks like random key material rather than prose, a hash or a path.
 * I-8 r4: a token with a digit and one letter case is judged too (`k9x...` lower case, `K9X...` upper case),
 * at a lower bar because its alphabet is 36 symbols and not 62; hex is the exception, since a digest or a
 * commit id is hex and cannot reach either bar.
 */
function looksRandom(token) {
  if (token.length < ENTROPY_MIN_LENGTH || token.length > ENTROPY_MAX_LENGTH) return false;
  if (isIntegrityHash(token)) return false;
  // C-2 r4: the whole token is scored unless structure covers half of it (`com/advisories/GHSA-9g45-5xwm-f3wc`), so
  // chance cuts in a random base64url token cannot make it slip. Its residue is scored too, which is how a secret
  // behind a long run of words (`/home/user/projects/keys/<random>`) is still found.
  const pieces = residuePieces(token);
  const residue = pieces.reduce((sum, piece) => sum + piece.replace(EDGE_DELIMITERS, '').length, 0);
  if (residue * 2 > token.length && scoresAsRandom(token)) return true;
  return pieces.some((piece) => piece.length >= ENTROPY_MIN_LENGTH && piece.length < token.length && scoresAsRandom(piece));
}

/** C-6: whether `token`, already in the length range, has the classes, the spread and the entropy of key material. */
function scoresAsRandom(token) {
  // I-8 r4: `sha512-` in front of anything but one digest is not an exemption; judge what follows as a token of its own.
  const integrity = INTEGRITY_PREFIX.exec(token);
  if (integrity !== null) {
    const digest = token.slice(integrity[0].length);
    if (digest.length >= ENTROPY_MIN_LENGTH && scoresAsRandom(digest)) return true;
  }
  const hasLower = /[a-z]/.test(token);
  const hasUpper = /[A-Z]/.test(token);
  if (!(/\d/.test(token) && (hasLower || hasUpper))) return false;
  const threshold = hasLower && hasUpper ? ENTROPY_THRESHOLD : ENTROPY_THRESHOLD_ONE_CASE;
  // The one-case bar applies to a plain alphanumeric string only: a snake_case name, a kebab-case slug, a path or a
  // `key=hex` pair holds a separator and is code or prose (measured: 38 files of this repository otherwise).
  if (threshold === ENTROPY_THRESHOLD_ONE_CASE && !PLAIN_ALPHANUMERIC.test(token)) return false;
  // Words glued together with a number on the end (`examplewebuiidentitypoolconfigsettingsnamevalue000000000001`) hold a
  // run of letters no random 36-symbol string has: about 1 in 300 at 40 characters.
  if (threshold === ENTROPY_THRESHOLD_ONE_CASE && LONG_LETTER_RUN.test(token)) return false;
  if (isMostlySequential(token) || (hasLower && hasUpper && isIdentifierLike(token))) return false;
  return shannonEntropy(token) >= threshold;
}

/**
 * C-6: whether `token` is an alphabet or a counter: half or more of its characters sit in runs of
 * SEQUENTIAL_RUN or more characters whose codes each rise by one.
 * I-8 r4: this used to be "holds one such run", so `abcdef` anywhere in a random token exempted all of
 * it. One run in a random token is a coincidence of 6 characters, not half of it.
 */
function isMostlySequential(token) {
  let covered = 0;
  let run = 1;
  for (let i = 1; i <= token.length; i += 1) {
    if (i < token.length && token.charCodeAt(i) === token.charCodeAt(i - 1) + 1) {
      run += 1;
    } else {
      if (run >= SEQUENTIAL_RUN) covered += run;
      run = 1;
    }
  }
  return covered * 2 >= token.length;
}

/** I-8 r4: whether `bytes` is one DER SEQUENCE whose declared length is exactly the bytes that follow its header. */
function isDerSequence(bytes) {
  if (bytes.length < 2 || bytes[0] !== 0x30) return false;
  if (bytes[1] < 0x80) return bytes.length === 2 + bytes[1];
  const count = bytes[1] & 0x7f;
  if (count < 1 || count > 4 || bytes.length < 2 + count) return false;
  let length = 0;
  for (let i = 0; i < count; i += 1) length = length * 256 + bytes[2 + i];
  return bytes.length === 2 + count + length;
}

/** I-8 r4: the OpenPGP CRC-24 (RFC 4880 section 6.1) of `bytes`. */
function crc24(bytes) {
  let crc = 0xb704ce;
  for (const byte of bytes) {
    crc ^= byte << 16;
    for (let bit = 0; bit < 8; bit += 1) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= 0x1864cfb;
    }
  }
  return crc & 0xffffff;
}

/** I-8 r4: whether `body` (the text between a PGP armor line and its end line) is armored data with a matching CRC-24 line. */
function isArmoredPgpBody(body) {
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  // Armor headers (`Version: ...`) run up to the first blank line.
  if (i < lines.length && lines[i].includes(':')) {
    while (i < lines.length && lines[i].trim() !== '') i += 1;
  }
  const data = [];
  let checksum = null;
  for (; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === '') continue;
    if (line[0] === '=' && line.length === 5 && checksum === null) {
      checksum = line.slice(1);
    } else if (checksum === null && /^[A-Za-z0-9+/]*={0,2}$/.test(line)) {
      data.push(line);
    } else {
      return false;
    }
  }
  if (data.length === 0 || checksum === null || !/^[A-Za-z0-9+/]{4}$/.test(checksum)) return false;
  const expected = Buffer.from(checksum, 'base64');
  return expected.length === 3 && crc24(Buffer.from(data.join(''), 'base64')) === expected.readUIntBE(0, 3);
}

/**
 * I-8 r4: whether a PEM block labelled `label` holds a certificate, a public key, a request or a PGP
 * armor and not a secret dressed as one. The body must be base64 that decodes to exactly one DER
 * SEQUENCE (every X.509 and SPKI structure is one) or, for a `PGP ` label, armored data whose CRC-24
 * line matches. `BEGIN CERTIFICATE` around 40 characters of random text is neither.
 */
function isGenuinePemBody(label, body) {
  if (/PRIVATE/.test(label)) return false;
  if (label.startsWith('PGP ')) return isArmoredPgpBody(body);
  if (!/^[A-Za-z0-9+/=\s]+$/.test(body)) return false;
  return isDerSequence(Buffer.from(body, 'base64'));
}

/**
 * C-6: text with every PEM block that is a genuine certificate or public key blanked out. Such a block
 * is a long base64 body with no secret in it and must not trip the entropy rule. Private key blocks were
 * refused earlier.
 * I-8 r4: it used to blank anything between a BEGIN and an END line, so a secret wrapped in
 * `-----BEGIN CERTIFICATE-----` was never scanned; a block is now blanked only when isGenuinePemBody
 * says so, and any other block is scanned like the rest of the text. Linear: a block body holds no
 * `-----`, so no two bodies overlap, and each END marker is searched for once.
 */
function withoutPemBlocks(text) {
  let out = '';
  let from = 0;
  let search = 0;
  let end = -2;
  for (;;) {
    const begin = text.indexOf('-----BEGIN ', search);
    if (begin === -1) break;
    if (end !== -1 && end < begin) end = text.indexOf('-----END ', begin);
    if (end === -1) break;
    search = begin + '-----BEGIN '.length;
    const labelEnd = text.indexOf('-----', search);
    if (labelEnd === -1 || labelEnd > end) continue;
    const label = text.slice(search, labelEnd);
    const bodyStart = labelEnd + 5;
    if (label.length > 40 || label.includes('\n') || text.indexOf('-----', bodyStart) !== end) continue;
    if (!isGenuinePemBody(label, text.slice(bodyStart, end))) continue;
    const close = text.indexOf('-----', end + '-----END '.length);
    const stop = close === -1 ? text.length : close + 5;
    out += text.slice(from, begin);
    from = stop;
    search = stop;
  }
  return out + text.slice(from);
}

/**
 * C-2 r4: whether the whole of `value` is a reference or a template and not a literal: `${VAR}`,
 * `$VAR`, `%VAR%`, `{{ var }}`, `<placeholder>`, `%(name)s`, `$(cmd)`, `{var}`, `***`. A value that merely
 * starts or contains one of those characters is not. A name that holds a digit must also be upper case
 * (`${DB_PASS2}` and `${{ secrets.DB_PASS2 }}` are references; `$uperS3cret`, `<Pr0dRootPw>` and `{{s3cr3t}}` are passwords).
 */
function isReferenceValue(value) {
  // `%(pass2)s` names a Python format argument, which is lower case by convention and is not a password.
  if (FORMAT_REFERENCE.test(value)) return true;
  const shaped =
    MASKED_VALUE.test(value) ||
    DOLLAR_BRACE_REFERENCE.test(value) ||
    TEMPLATE_REFERENCE.test(value) ||
    ANGLE_PLACEHOLDER.test(value) ||
    VARIABLE_REFERENCE.test(value);
  // Each name inside the value is judged on its own: `secrets.DB_PASS2` is `secrets` and `DB_PASS2`, both fine, and
  // `s3cr3t` and `Pr0dRootPw` each hold a digit and a lower-case letter, which no environment variable name does.
  return shaped && value.split(/[^A-Za-z0-9]+/).every((name) => !(/\d/.test(name) && /[a-z]/.test(name)));
}

/**
 * C-2 r4: whether `value` is a call or an index on a name (`getToken(opts2)`, `sys.argv[1]`, `base64.b16encode(x)`).
 * A name with no dot may not hold a digit, so `hunter2(1)` is a password and `base64.b16encode(x)` is code.
 */
function isCodeExpression(value) {
  const match = CODE_EXPRESSION.exec(value);
  return (match !== null && (match[1].includes('.') || !/\d/.test(match[1]))) || INDEX_PATH.test(value);
}

/**
 * C-2 r4: `value` without the closing brackets that have no opener inside it: the `)` of `f(token=abc123)`
 * is the caller's, the `)` of `P@ssw0rd(1)` is the password's. Linear: the brackets are counted once.
 */
function withoutStrayClosers(value) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const open = { '(': 0, '[': 0, '{': 0 };
  const close = { ')': 0, ']': 0, '}': 0 };
  for (const char of value) {
    if (char in open) open[char] += 1;
    else if (char in close) close[char] += 1;
  }
  let end = value.length;
  while (end > 0 && value[end - 1] in close && close[value[end - 1]] > open[pairs[value[end - 1]]]) {
    close[value[end - 1]] -= 1;
    end -= 1;
  }
  return value.slice(0, end);
}

/**
 * C-6: group 2. Whether `raw`, taken after a secret-looking name, looks like a literal secret. `bare` is
 * true for the keywords `pass` and `pw`, which also occur in prose.
 */
function looksLikeSecretValue(raw, bare) {
  if (raw.length < MIN_ASSIGNED_VALUE || raw.length > MAX_ASSIGNED_VALUE) return false;
  if (isReferenceValue(raw) || ABNF_REPEAT.test(raw) || REGEX_LITERAL.test(raw)) return false;
  const value = withoutStrayClosers(raw);
  if (value.length < MIN_ASSIGNED_VALUE || IDENTIFIER_CHAIN.test(value) || isCodeExpression(value)) return false;
  // C-2 r4: a call that the value scan cut short at a comma or a blank (`getToken(opts2, x)`) still holds an open bracket.
  // `hunter2(1)` has a digit before the bracket and `P@ssw0rd(1)` has an `@`, so neither is read as a call.
  if (CALL_PREFIX.test(value) && (value.match(/[([]/g) || []).length > (value.match(/[)\]]/g) || []).length) return false;
  // A digit is required: `string`, `required`, `nextToken` and `my-secret-name` are not credentials,
  // `hunter2` and `S3cr3tPassw0rd` are. A password with no digit in it is a known miss; accepting
  // every six-character word after `token:` would refuse most schema and type definitions.
  if (!/\d/.test(value)) return false;
  // C-2 r4: after a bare `pass` or `pw` the value must also hold a letter, so `Pass: 90-100` and `pass = 1000000`
  // in prose or a score table are not read as a password. A password of digits only after `pass` is a known miss.
  return !bare || /[A-Za-z]/.test(value);
}

/** C-6: group 2. Whether `text` assigns a literal to a secret-looking name. */
function hasSecretAssignment(text) {
  SECRET_KEYWORD.lastIndex = 0;
  for (let match = SECRET_KEYWORD.exec(text); match !== null; match = SECRET_KEYWORD.exec(text)) {
    const word = match[1];
    const before = match.index === 0 ? '' : text[match.index - 1];
    // `bypass` and `clientsecret` end in a word without a word boundary; `byPass`, `ClientSecret`
    // and `CLIENT_SECRET` have one.
    if (/[A-Za-z]/.test(before) && /[a-z]/.test(word[0])) continue;
    let i = match.index + match[0].length;
    // `==` and `===` compare against a literal secret just as `=` assigns it; `=>` is an arrow.
    while (text[i] === '=') i += 1;
    while (text[i] === ' ' || text[i] === '\t') i += 1;
    // `=>` is an arrow and `::` is a path separator (`token::new`), not an assignment.
    if (text[i] === '>' || text[i] === ':') continue;
    const quote = text[i] === '"' || text[i] === "'" || text[i] === '`' ? text[i] : null;
    if (quote !== null) i += 1;
    let j = i;
    const limit = Math.min(text.length, i + MAX_ASSIGNED_VALUE + 1);
    // C-2 r4: an unquoted value runs to a blank, a quote or `;,&`. It used to stop at `)`, `}` and `]` as well, which
    // cut `password=[Pr0d]x` to five characters and `${VAR}` to `${VAR`; looksLikeSecretValue drops a stray closer.
    while (j < limit) {
      const char = text[j];
      if (quote !== null ? char === quote || char === '\n' : /[\s'"`;,&]/.test(char)) break;
      j += 1;
    }
    const value = text.slice(i, j);
    // A quoted value with a space in it is a sentence (a password with a space in it is a known miss).
    if (quote !== null && (/\s/.test(value) || text[j] !== quote)) continue;
    if (looksLikeSecretValue(value, BARE_KEYWORD.test(word))) return true;
  }
  return false;
}

/** C-6: group 3. Whether `text` holds a URL with a literal password in its userinfo. */
function hasConnectionStringPassword(text) {
  CONNECTION_STRING.lastIndex = 0;
  for (let match = CONNECTION_STRING.exec(text); match !== null; match = CONNECTION_STRING.exec(text)) {
    if (!PLACEHOLDER_PASSWORD.test(match[2]) && !isReferenceValue(match[2])) return true;
  }
  return false;
}

/**
 * C-6: group 4. Whether `text` holds a run of base64-alphabet characters, anywhere, that looks random.
 * C-2 r4: "anywhere" replaces "after a quote, `=` or `:`, or alone on its line". A run that holds `=` is
 * judged part by part, so a token after `key=` is not diluted by its label, and a token in a URL path
 * (`/keys/<token>/x`) is not diluted by the words around it (see looksRandom). A run longer than
 * ENTROPY_MAX_LENGTH is a blob and is not examined.
 */
function hasHighEntropyToken(text) {
  const body = withoutPemBlocks(text);
  ENTROPY_RUN.lastIndex = 0;
  for (let match = ENTROPY_RUN.exec(body); match !== null; match = ENTROPY_RUN.exec(body)) {
    const run = match[0];
    if (run.length > ENTROPY_MAX_LENGTH || isIntegrityHash(run)) continue;
    // C-2 r4: an inline image or font (`data:image/png;base64,...`) is not a secret. Anyone can write that prefix
    // before a secret, which makes it a known miss (see the header); it is the cost of not refusing every web page.
    if (DATA_URI_BEFORE.test(body.slice(Math.max(0, match.index - 80), match.index))) continue;
    // A `name=value` run is judged by its parts: `package_id=` is a label, and joined to the value it dilutes it.
    // The split is on `=` only: `/` can sit inside a secret (an AWS secret key has two), and a path is handled by
    // looksRandom, which cuts the words out of a run and judges what is left.
    if (!run.replace(/=+$/, '').includes('=')) {
      if (looksRandom(run)) return true;
      continue;
    }
    for (const part of run.split(/=+/)) {
      if (part.length >= ENTROPY_MIN_LENGTH && looksRandom(part)) return true;
    }
  }
  return false;
}

/**
 * I-8, C-6: why `text` is a credential, or null. Runs the four groups in order and stops at the
 * first hit. See the module header for what the groups claim and what they miss.
 */
function sensitiveContentReason(text) {
  if (typeof text !== 'string') return null;
  const found = SENSITIVE_CONTENT.find(({ pattern }) => pattern.test(text));
  if (found !== undefined) return found.reason;
  if (hasSecretAssignment(text)) return 'a secret-looking assignment (a password, secret, token or key given a literal value)';
  if (hasConnectionStringPassword(text)) return 'a connection string that carries a password';
  if (hasHighEntropyToken(text)) return 'a high-entropy token that looks like key material';
  return null;
}

/**
 * C-6: the SHA-256 of `input` as lower-case hex, the digest `allowSensitive` pins. A string is
 * hashed as UTF-8; pass a Buffer to pin exact bytes, which is what the loader hashes.
 */
function contentDigest(input) {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  if (!(bytes instanceof Uint8Array)) throw new TypeError('snapshot-loader: contentDigest needs a string or a Buffer');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * I-8, C-6: validates `options` and returns the limits and the allowed sensitive paths, as a map
 * from exact path to the digest that pins its content, or to null when only the name is allowed.
 * Throws a TypeError for anything unrecognised or malformed: a silent default would hide a miswired limit.
 */
function readOptions(options) {
  if (options === undefined) return { ...DEFAULT_LIMITS, allowSensitive: new Map() };
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('snapshot-loader: options must be a plain object');
  }
  for (const key of Object.keys(options)) {
    if (!OPTION_NAMES.includes(key)) {
      throw new TypeError(`snapshot-loader: unknown option ${JSON.stringify(key)}; expected one of ${OPTION_NAMES.join(', ')}`);
    }
  }
  const limits = {};
  for (const name of Object.keys(DEFAULT_LIMITS)) {
    const value = Object.hasOwn(options, name) ? options[name] : undefined;
    if (value === undefined) {
      limits[name] = DEFAULT_LIMITS[name];
    } else if (Number.isSafeInteger(value) && value >= 0) {
      limits[name] = value;
    } else {
      throw new TypeError(`snapshot-loader: ${name} must be a non-negative integer, got ${String(value)}`);
    }
  }
  const allowed = Object.hasOwn(options, 'allowSensitive') ? options.allowSensitive : undefined;
  const allowSensitive = new Map();
  if (allowed !== undefined) {
    const bad = () =>
      new TypeError('snapshot-loader: allowSensitive must be an array of exact relative file paths, or of { path, sha256 } objects whose sha256 is the lower-case hex digest of the fixture');
    if (!Array.isArray(allowed)) throw bad();
    for (const entry of allowed) {
      let allowedPath;
      let digest = null;
      if (typeof entry === 'string') {
        allowedPath = entry;
      } else if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
        // C-6: the pinned form. Exactly these two keys, so a misspelled key cannot silently mean "no pin".
        const keys = Object.keys(entry).sort();
        if (keys.length !== 2 || keys[0] !== 'path' || keys[1] !== 'sha256') throw bad();
        allowedPath = entry.path;
        digest = entry.sha256;
        if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) throw bad();
      } else {
        throw bad();
      }
      if (typeof allowedPath !== 'string' || allowedPath === '') throw bad();
      // C-6: one entry per path, so a name-only entry cannot sit next to a pinned one and widen it.
      if (allowSensitive.has(allowedPath)) {
        throw new TypeError(`snapshot-loader: allowSensitive lists ${JSON.stringify(allowedPath)} more than once`);
      }
      allowSensitive.set(allowedPath, digest);
    }
  }
  return { ...limits, allowSensitive };
}

/**
 * I-7: decodes `bytes` as UTF-8 without loss. Valid UTF-8 decodes as usual; each byte that is not
 * part of a valid sequence becomes the lone surrogate U+DC00 plus the byte. No valid input produces
 * a lone surrogate, so the mapping is one to one.
 */
function decodeLossless(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    // Fall through to the byte-by-byte decoder below.
  }
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const lead = bytes[i];
    let need = 0;
    let min = 0;
    let code = lead;
    if (lead < 0x80) {
      out += String.fromCharCode(lead);
      i += 1;
      continue;
    }
    if (lead >= 0xc2 && lead <= 0xdf) {
      need = 1;
      min = 0x80;
      code = lead & 0x1f;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      need = 2;
      min = 0x800;
      code = lead & 0x0f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      need = 3;
      min = 0x10000;
      code = lead & 0x07;
    }
    let valid = need > 0;
    if (valid) {
      for (let k = 1; k <= need; k += 1) {
        const next = bytes[i + k];
        if (next === undefined || (next & 0xc0) !== 0x80) {
          valid = false;
          break;
        }
        code = (code << 6) | (next & 0x3f);
      }
    }
    if (valid && (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))) valid = false;
    if (valid) {
      out += String.fromCodePoint(code);
      i += need + 1;
    } else {
      out += String.fromCharCode(0xdc00 + lead);
      i += 1;
    }
  }
  return out;
}

/**
 * I-H: how the loader descends. Returns 'darwin' or 'linux', or throws when the platform offers no
 * descent whose safety it can show. It never falls back to resolving every path by name.
 */
function selectDescent() {
  const platform = os.platform();
  if (platform === 'darwin') return 'darwin';
  if (platform === 'linux' && fs.existsSync(LINUX_FD_DIRECTORY)) return 'linux';
  throw new Error(
    `snapshot-loader: refusing to run on ${platform}${platform === 'linux' ? ' without /proc' : ''}: a directory swapped for a symbolic link while the tree is read cannot be ruled out here, so the loader reads nothing instead of reading by path`,
  );
}

/**
 * I-H: the no-link flag for an open. On Linux it is `O_NOFOLLOW`, which guards the last component
 * and is enough because the parent is a descriptor. On macOS it is `O_NOFOLLOW_ANY`, which makes the
 * kernel refuse a link in any component; it replaces `O_NOFOLLOW` and cannot be combined with it
 * (the open fails with EINVAL).
 */
function noFollowFlag(descent) {
  return descent === 'darwin' ? DARWIN_O_NOFOLLOW_ANY : fs.constants.O_NOFOLLOW || 0;
}

/** I-H: the error for an entry that is not what its listing said it was. */
function changedWhileReading(relative, error) {
  return new Error(
    `snapshot-loader: ${relative === '' ? 'the root' : relative} changed while it was being read (${error && error.code ? error.code : 'not what was listed'}); a workspace that is being modified is not read`,
  );
}

/** I-H: the path to open for `name` inside the directory `parent` holds open. */
function childPath(descent, parent, name) {
  // Linux: the kernel resolves the descriptor, so no ancestor is looked up by name again.
  // Darwin: a plain path, protected by O_NOFOLLOW_ANY on every open.
  return descent === 'linux' ? `${LINUX_FD_DIRECTORY}/${parent.fd}/${name}` : `${parent.path}/${name}`;
}

/**
 * I-H: opens a directory without following a link and returns `{ fd, path }`. `relative` is only
 * for the error message; an open that fails for a reason that means "this is not the directory that
 * was listed" becomes an error that says so, anything else (EACCES, EMFILE) passes through.
 */
function openDirectory(descent, full, relative) {
  const flags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | noFollowFlag(descent);
  try {
    return { fd: fs.openSync(full, flags), path: full };
  } catch (error) {
    if (relative !== '' && error && ['ELOOP', 'ENOTDIR', 'ENOENT'].includes(error.code)) throw changedWhileReading(relative, error);
    throw error;
  }
}

/**
 * I-H: lists the directory held open as `handle`. On Linux the listing comes from the descriptor
 * itself. On macOS it comes from the path and is then checked against the descriptor's identity
 * (device and inode): a directory replaced while it was listed is an error, so a listing of some
 * other directory is never trusted. Even then a name from it is only ever opened under
 * O_NOFOLLOW_ANY, so it could not be read from outside the root.
 */
function listDirectory(descent, handle, relative) {
  if (descent === 'linux') return fs.readdirSync(`${LINUX_FD_DIRECTORY}/${handle.fd}`, { withFileTypes: true });
  const entries = fs.readdirSync(handle.path, { withFileTypes: true });
  let current;
  try {
    current = fs.lstatSync(handle.path);
  } catch (error) {
    throw changedWhileReading(relative, error);
  }
  const held = fs.fstatSync(handle.fd);
  if (!current.isDirectory() || current.dev !== held.dev || current.ino !== held.ino) throw changedWhileReading(relative);
  return entries;
}

/**
 * I-8: reads at most `limit` bytes of the regular file at `full` through an open handle. Returns
 * `{ bytes }` or `{ over: true }` when the file holds more than `limit` bytes. A file that is no
 * longer a regular file by the time it is opened (a link or special file swapped in after the
 * directory was listed) is an error. Never opens a link (`noFollowFlag`, I-H) and never blocks on a
 * pipe (O_NONBLOCK).
 */
function readBounded(full, limit, relative, noFollow) {
  const flags = fs.constants.O_RDONLY | noFollow | (fs.constants.O_NONBLOCK || 0);
  let fd;
  try {
    fd = fs.openSync(full, flags);
  } catch (error) {
    if (error && ['ELOOP', 'ENXIO', 'ENOENT', 'ENOTDIR'].includes(error.code)) throw changedWhileReading(relative, error);
    throw error;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) throw changedWhileReading(relative);
    // Reading stops one byte past the limit, so a file over the limit is seen as over however
    // large it was when it was first listed, and a huge limit allocates nothing up front.
    const chunks = [];
    let filled = 0;
    while (filled <= limit) {
      const chunk = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, limit + 1 - filled));
      const read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      chunks.push(chunk.subarray(0, read));
      filled += read;
    }
    if (filled > limit) return { over: true };
    return { bytes: Buffer.concat(chunks, filled) };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Loads the tree under `rootDir` into a snapshot. `options` may override `maxFiles`,
 * `maxFileBytes` and `maxTotalBytes` (non-negative integers) and may list paths in
 * `allowSensitive`, each an exact relative path or a `{ path, sha256 }` pin (C-6). Skipped entries
 * (`.git`, `node_modules`) appear as empty-valued markers (I-A). Throws on a bad root, bad options,
 * a sensitive file, a breached limit, a workspace that changes while it is read (I-H), or a
 * platform with no safe descent.
 */
function loadSnapshot(rootDir, options) {
  if (typeof rootDir !== 'string' || rootDir === '') {
    throw new TypeError('snapshot-loader: rootDir must be a non-empty string');
  }
  const { maxFiles, maxFileBytes, maxTotalBytes, allowSensitive } = readOptions(options);
  const descent = selectDescent();
  const noFollow = noFollowFlag(descent);

  const entries = [];
  let fileCount = 0;
  let totalBytes = 0;

  const refuse = (relative, why) => {
    throw new Error(
      `snapshot-loader: refusing to load ${relative}: ${why}. Remove it from the workspace, or list the exact path in options.allowSensitive if the task needs it (a bare path admits the name only; pin a fixture whose content is refused as { path, sha256 })`,
    );
  };

  // I-H: `dir` is a directory this walk holds open. Its children are reached through it, never by
  // resolving the names of its ancestors again.
  const walk = (dir, relativeDir) => {
    const dirents = listDirectory(descent, dir, relativeDir);
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const dirent of dirents) {
      const relative = relativeDir === '' ? dirent.name : `${relativeDir}/${dirent.name}`;
      // I-8: `.git` is skipped by name, so a worktree's `.git` file is not read as content.
      // I-A: the entry is not read but is recorded, so a check can tell that something is there.
      if (isSkippedName(dirent.name)) {
        entries.push([relative, '']);
        continue;
      }
      if (dirent.isDirectory()) {
        const child = openDirectory(descent, childPath(descent, dir, dirent.name), relative);
        try {
          walk(child, relative);
        } finally {
          fs.closeSync(child.fd);
        }
      } else if (dirent.isFile()) {
        if (fileCount >= maxFiles) {
          throw new Error(`snapshot-loader: more than ${maxFiles} files under the root`);
        }
        fileCount += 1;
        // C-6: Map.get gives undefined for a path that is not allowed, null for a name-only
        // allowance, and the pinned digest otherwise.
        const allowance = allowSensitive.get(relative);
        const allowed = allowance !== undefined;
        const nameReason = allowed ? null : sensitivePathReason(relative);
        // I-8: refused before it is opened, so the content never enters memory.
        if (nameReason !== null) refuse(relative, nameReason);
        // I-8: the limits apply to the bytes read, whatever `stat` said when the entry was listed.
        const read = readBounded(childPath(descent, dir, dirent.name), Math.min(maxFileBytes, maxTotalBytes - totalBytes), relative, noFollow);
        if (read.over) {
          if (maxFileBytes <= maxTotalBytes - totalBytes) {
            throw new Error(`snapshot-loader: ${relative} is over the ${maxFileBytes} byte limit`);
          }
          throw new Error(`snapshot-loader: content exceeds ${maxTotalBytes} bytes in total`);
        }
        totalBytes += read.bytes.length;
        const text = decodeLossless(read.bytes);
        // C-6: the content scan is skipped only for bytes that hash to the pinned digest. A path that
        // is allowed by name alone, or whose bytes differ from the pin, is scanned like any other file.
        const pinned = allowance !== undefined && allowance !== null && contentDigest(read.bytes) === allowance;
        const contentReason = pinned ? null : sensitiveContentReason(text);
        if (contentReason !== null) refuse(relative, `its content holds ${contentReason}`);
        entries.push([relative, text]);
      }
    }
  };

  // I-H: the root is resolved once, here, and trusted: it is the caller's argument, not workspace
  // content. Everything below it is reached through descriptors or under O_NOFOLLOW_ANY.
  const root = openDirectory(descent, fs.realpathSync(rootDir), '');
  try {
    walk(root, '');
  } finally {
    fs.closeSync(root.fd);
  }
  // fromEntries defines own properties, so a file named `__proto__` stays a plain key.
  return Object.fromEntries(entries);
}

module.exports = { DEFAULT_LIMITS, SKIPPED_DIRECTORIES, loadSnapshot, decodeLossless, sensitiveContentReason, contentDigest };
