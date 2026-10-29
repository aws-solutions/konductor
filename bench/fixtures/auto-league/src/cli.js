'use strict';

const { loadMatches } = require('./matches');
const { summarize } = require('./stats');
const { formatTable } = require('./format');

function stats(_args, { dataDir }) {
  const rows = summarize(loadMatches(dataDir)).map((s) => [s.player, s.played, s.won, s.drawn, s.lost, s.goalsFor, s.goalsAgainst]);
  return `${formatTable(['player', 'played', 'won', 'drawn', 'lost', 'for', 'against'], rows)}\n`;
}

const COMMANDS = { stats };

function run(argv, ctx) {
  const [name, ...args] = argv;
  if (!COMMANDS[name]) return { code: 2, out: `unknown command: ${name ?? ''}\n` };
  return { code: 0, out: COMMANDS[name](args, ctx) };
}

module.exports = { run };
