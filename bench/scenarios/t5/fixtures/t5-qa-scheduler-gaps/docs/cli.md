# Command line

`python3 -m schedulerlib schedule "0 8 * * 1-5" --after 2025-01-06T07:00:00`
prints the next ISO timestamp. `python3 -m schedulerlib state PATH` prints the
number of keys in a state document.
