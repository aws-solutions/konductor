// SPDX-License-Identifier: Apache-2.0
// Child process for the ledger race test: waits for a start file so all children reserve together, makes one
// $1 reservation against a $3 total_cap_usd, and prints { ok } or { limit }. Not a test file (the glob skips it).
'use strict';

const fs = require('fs');
const path = require('path');
const { createLedger } = require('../../../scripts/bench/lib/ledger');

const [file, runId, readyDir, goFile] = process.argv.slice(2);
fs.writeFileSync(path.join(readyDir, runId), '');
const deadline = Date.now() + 10000;
while (!fs.existsSync(goFile) && Date.now() < deadline); // busy wait: the start must be as close together as possible
createLedger({
  file,
  runId,
  limits: { max_usd: 100, total_cap_usd: 3 },
})
  .reserve(1, `child ${runId}`)
  .then(() => console.log(JSON.stringify({ ok: true })))
  .catch((error) =>
    console.log(JSON.stringify({ limit: error.limit || error.message })),
  );
