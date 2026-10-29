'use strict';

// Per-player totals, sorted by name. "Goals" are the games each side won in a match.
function summarize(matches) {
  const rows = new Map();
  const row = (player) => {
    if (!rows.has(player)) rows.set(player, { player, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 });
    return rows.get(player);
  };
  for (const m of matches) {
    const home = row(m.home);
    const away = row(m.away);
    home.played++;
    away.played++;
    home.goalsFor += m.homeGoals;
    home.goalsAgainst += m.awayGoals;
    away.goalsFor += m.awayGoals;
    away.goalsAgainst += m.homeGoals;
    if (m.homeGoals > m.awayGoals) { home.won++; away.lost++; }
    else if (m.homeGoals < m.awayGoals) { away.won++; home.lost++; }
    else { home.drawn++; away.drawn++; }
  }
  return [...rows.values()].sort((a, b) => a.player.localeCompare(b.player));
}

module.exports = { summarize };
