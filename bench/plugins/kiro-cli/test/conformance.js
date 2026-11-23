// SPDX-License-Identifier: Apache-2.0
'use strict';

// What the plugin kit (bench/kit/plugin) needs to check the Kiro CLI plugin with no model call: a recorded stream of
// one single-turn run (kiro-cli's ACP updates), its run config, and what parseResult reads besides the stream. Kiro CLI
// keeps its credit total and model in a session file under HOME, so `setup` writes that file for the stream's session.
const fs = require('node:fs');
const path = require('node:path');

const FIXTURE = 'fixtures/single-turn.jsonl';

/** The session id the recorded stream names (its first `sessionId` field). */
function sessionIdOf() {
  const text = fs.readFileSync(path.join(__dirname, FIXTURE), 'utf8');
  return /"sessionId":"([^"]+)"/.exec(text)[1];
}

module.exports = {
  fixture: FIXTURE,
  freeModel: false,
  config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' },
  setup({ home }) {
    const sessionId = sessionIdOf();
    const dir = path.join(home, '.kiro', 'sessions', 'cli');
    fs.mkdirSync(dir, { recursive: true });
    const turn = { model: 'claude-sonnet-5.5', total_request_count: 2, metering_usage: [{ value: 0.02, unit: 'credit' }] };
    fs.writeFileSync(path.join(dir, `${sessionId}.json`), JSON.stringify({ session_state: { conversation_metadata: { user_turn_metadatas: [turn] } } }));
    fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), '{"kind":"Prompt"}\n');
    // A stand-in for the kiro-cli login database installInto copies into the scratch HOME (no real login).
    const authDb = path.join(home, '..', 'auth.sqlite3');
    fs.writeFileSync(authDb, 'stub auth db\n');
    // Only named on the command line; the kit's fake-run starts its replay agent in its place.
    return { kiroBin: path.join(home, '..', 'bin', 'kiro-cli'), authDb };
  },
  // The recorded run makes no plant call; plant-kind still checks the mount, the pin and the reader.
  plantCalls: 0,
};
