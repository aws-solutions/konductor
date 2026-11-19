You are tagging ONE benchmark task with the units of an agent toolkit that would genuinely help an agent do it well. Work only inside the current directory. Read `task.json` (the request, the repository's file list and the scoring checks) and `units.json` (each unit's kind, name and one-line description; kinds are skill, sop and agent). Do not read anything else.

Pick only units whose description says they help with exactly this kind of work. Prefer fewer: 1 to 3 skills, at most one sop and at most one agent, or none of a kind when nothing fits. Do not pick general units that would help with any task.

Write `map.json`:
{ "targetSkills": ["skill names"], "targetSop": "sop name or null", "targetAgent": "agent name or null",
  "loadCheck": { "mustLoad": ["the one or two skill names that must load before the agent's first write"], "mustNotLoad": ["skills that look related by words but would not help, at most 3"] },
  "twinIdea": "one sentence: a different request on the same repository where the chosen skills would NOT help",
  "why": "two sentences" }
Use names exactly as they appear in units.json. Then stop.
