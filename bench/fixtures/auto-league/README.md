# table-tennis-league

Match results and per-player statistics for the office league.

```js
const { loadMatches, summarize } = require('./src');

summarize(loadMatches('data'));
// [{ player: 'Ana', played: 4, won: 2, drawn: 1, lost: 1, goalsFor: 6, goalsAgainst: 4 }, ...]
```

## Matches

`data/matches.json` is an array of `{ home, away, homeGoals, awayGoals, playedOn }`. A player is a name string.
Every pair plays once. See `docs/RULES.md` for how a match is recorded.

## Commands

`node bin/league.js stats` prints the statistics table (`src/cli.js`).

## Layout

- `src/matches.js` loading and validating matches
- `src/stats.js` per-player totals
- `src/format.js` text table helpers
- `src/cli.js` the `stats` command
