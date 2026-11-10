# program-planning fixture key (judge-only)

items.csv + brief.md (p1, p3): critical path W1(M) -> W2(L, novel) -> W3(XL) -> W5(L) -> W7(M).
Minimum unbuffered: 1-2w + 3-4w + 5-8w + 3-4w + 1-2w = 13-20 weeks. Start 2027-01-04 to 2027-03-26 is 12 weeks,
so the GA date is not achievable even before buffers (20% floor, 40% for novel W2/W8). Plan must say so.
Priya owns W1, W2, W7, W8 (W2 and W8 overlap): over-allocation risk. W6 is external, W4/W6/W8 have float.

plan-draft.md (p2): M3 <-> M5 circular dependency (CRITICAL); M3 exit criteria "Better performance" not measurable (CRITICAL);
M6 GA 2027-03-30 earlier than its dependencies M4 (04-02) and M5 (04-09) (CRITICAL: end date before critical path);
no buffer applied (IMPORTANT); Dana at 150% in March (IMPORTANT); dependencies lack risk assessment (IMPORTANT).

v2 p3 (replaces the tasks.csv export, which any competent answer passed): status-2027-02-08.md replan.
- Critical path unchanged W1 -> W2 -> W3 -> W5 -> W7. W2 slip to 2027-03-05 moves GA directly.
- W6 slip is NOT on the path to GA: nothing in items.csv depends on W6 (float). The sponsor's alarm is misplaced; say so (or state the assumption if residency is assumed to gate GA).
- Contractor will not "cut W3 in half": onboarding, ramp-up on a brand-new framework, XL work; at best a modest reduction. Should not be presented as restoring 3/26.
- Rough forecast with W3 starting 2027-03-08: W3 5-8w (+20%) -> mid-April to mid-May; W5 3-4w (+20%); W7 1-2w (+20%) -> GA roughly late May at the earliest, realistically June to early July. Exact dates can vary by method; a committed date should be a range or have a confidence level, with buffers per skill (20% floor, 40% for novel W2/W8 remaining work).
- Deferring W8 frees Priya (who owns W2 and W7) but does not shorten the critical path by itself.
- 3/26 is not achievable. Freeze week 02-15..02-19 is now before W3 starts, so it no longer bites.
