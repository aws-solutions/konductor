# argumentation-reference fixture key
docs/proposal.md:
- J1 appeal to popularity (and hasty generalization from 3 companies); weak warrant; expected Beginner/low Intermediate.
- J2 false dichotomy; no evidence; Beginner.
- J3 strongest: data (LT-17), warrant (growth rate -> need), qualifier ("at least the next year"), rebuttal (replication factor caveat); expected Advanced (10-12) or Competitive.
- J4 appeal to authority, anecdotal hearsay, loaded term; Beginner.
Rubric: 5 criteria x 0-3 = 15 max; tiers 0-5 Beginner, 6-9 Intermediate, 10-12 Advanced, 13-15 Competitive.
docs/junior-draft.md: score < 6 -> coaching intervention "Rebuild from claim" (ask what exactly is claimed and what evidence supports it). Fallacies: appeal to novelty/popularity, unsupported causal claim ("GraphQL is faster" fixes slow app).
Toulmin p2 argument: "Postgres handled 10k TPS in our load test, so it will handle Black Friday" -> claim, data, warrant (load test representative of Black Friday), backing missing, qualifier missing, rebuttal (if Black Friday traffic exceeds 10k or has different mix).

v2 additions:
docs/black-friday-readiness.md (p2): claim "Postgres will handle Black Friday" + "no further capacity work needed" (overreach, no qualifier). Data: staging 10k TPS, 80/20 read/write mix, 15 min run. Unstated warrant: the load test is representative of Black Friday. The doc's own background undercuts it: Black Friday peak hour is ~55% writes (test was 20%), peak lasts ~3 h (test 15 min), volume +35% YoY (7,400 x 1.35 ~ 10,000 TPS, i.e. at the tested ceiling with no headroom). Backing missing (why staging = prod beyond instance class), qualifier missing, rebuttal absent. Expected score Beginner/low Intermediate (roughly 4-7/15), coaching at that band: strengthen warrant / rebuild claim; fix = rerun with the Black Friday write mix and duration at >=1.35x last peak, scope the claim.
