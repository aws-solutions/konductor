'use strict';

const { summarize } = require('./stats');

// Win 3, draw 1, loss 0. Order: points, goal difference, goals scored, then name.
// Players level on all three keys share a rank and the next rank is skipped (1, 2, 2, 4).
function leaderboard(matches) {
  const rows = summarize(matches).map((s) => ({
    ...s,
    goalDifference: s.goalsFor - s.goalsAgainst,
    points: s.won * 3 + s.drawn,
  }));
  rows.sort((a, b) => b.points - a.points
    || b.goalDifference - a.goalDifference
    || b.goalsFor - a.goalsFor
    || a.player.localeCompare(b.player));
  const level = (a, b) => a.points === b.points && a.goalDifference === b.goalDifference && a.goalsFor === b.goalsFor;
  rows.forEach((row, i) => {
    row.rank = i > 0 && level(rows[i - 1], row) ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

module.exports = { leaderboard };
