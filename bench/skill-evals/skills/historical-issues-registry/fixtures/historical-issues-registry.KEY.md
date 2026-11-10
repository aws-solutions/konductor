# historical-issues-registry fixture key (judge-only)

Classification (p2): T1 rejected, T2 fixed, T3 unresolved, T4 unresolved (author-only "won't fix", no reviewer),
T5 rejected, T6 unresolved, T7 wontfix, T8 unresolved, T9 unresolved, T10 rejected. T11 has no file anchor: ignored.

Filter (p1): suppress F1 (T1 rejected), F6 (T7 wontfix; renamed path handler.ts -> request-handler.ts, +15 lines).
Surface: F2 regression ("regressed since a fix on/after revision 2"), F3 carried over from revision 3 (T3 blocking=true),
F4 carried over from revision 2 (author-only wontfix is unresolved), F5 carried over from revision 3 (T5 rejected + T6 unresolved:
no unanimity, so surface; highest revision among unresolved = 3), F8 "carried over from a prior revision" (revision null).
Pass through as new: F7 (category differs from T8), F9 ("missing guard" is under 3 significant words, so no substring match to T10),
F10 (line 140 is outside +/-20 of T1 line 40).

Load (p3): 10 fingerprints (T11 excluded), each with file, line, category, defect_phrase, resolution, thread_id, revision, blocking;
T3 blocking true, others false; T9 revision null.
