'use strict';

const { summarize } = require('./stats');

// Win 3, draw 1, loss 0. Order: points, then name.
// Ranks are simply the row numbers.
function leaderboard(matches) {
  const rows = summarize(matches).map((s) => ({
    ...s,
    goalDifference: s.goalsFor - s.goalsAgainst,
    points: s.won * 3 + s.drawn,
  }));
  rows.sort((a, b) => b.points - a.points || a.player.localeCompare(b.player));
  rows.forEach((row, i) => { row.rank = i + 1; });
  return rows;
}

module.exports = { leaderboard };
