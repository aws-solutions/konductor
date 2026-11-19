// SPDX-License-Identifier: Apache-2.0
'use strict';

// The SR-32 split, recorded before any run (plan section 7): a task is DEV when the first 8 hex digits of
// sha256("konductor-2x2 SR-32 split v1:" + id), read as a number, are divisible by 3; otherwise it is HELD-OUT.
// Ids are fixed before hashing and never renamed to move a task.

const crypto = require('node:crypto');

const SALT = 'konductor-2x2 SR-32 split v1:';

/** The split hash of a task id: an integer from the first 8 hex digits of the salted sha256. */
const hashOf = (id) => parseInt(crypto.createHash('sha256').update(SALT + id).digest('hex').slice(0, 8), 16);

/** `DEV` or `HELD-OUT`. */
const splitOf = (id) => (hashOf(id) % 3 === 0 ? 'DEV' : 'HELD-OUT');

module.exports = { SALT, hashOf, splitOf };
