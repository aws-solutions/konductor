# Spikes: how we run them (engineering handbook, excerpt)

A spike answers one question so a decision can be made. It is not a first version of the feature.

1. Put the question and the date it is needed in the first lines of the write-up.
2. Keep spike code in its own top-level folder (`spike/`). Do not edit shared libraries
   (`lib/`) or checked-in data (`data/`) from a spike. If a library needs a change, say so in the write-up.
3. A spike script must run with plain `node` and print its result on stdout so the next person can re-run it.
4. Report what was measured, on which files, and how many rows or runs. Say what was not measured.
5. End the write-up with a decision-ready summary: what the question was, the answer, and what the answer
   depends on. If the answer is "it depends", write down on what.
6. Time box: one working day unless the owner agrees more. Stop and write up when the box ends.

Synthetic data is fine for a spike. Say so in the write-up, and do not quote synthetic numbers as customer numbers.
