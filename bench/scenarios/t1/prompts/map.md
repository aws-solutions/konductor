You are tagging one benchmark task. Below is the finished task (the request the agent receives, its checks, its rubric and the author's notes) and a catalogue of reusable capabilities (skills, SOPs, agents) of an agent toolkit, each with a name and, for skills, a one-line description. You see nothing else about the toolkit.

Decide which capabilities would genuinely help an agent do THIS task well. Be strict: name a capability only when its described purpose matches work the task really needs. An empty answer is fine. Do not use any tool.

Reply with one JSON object and nothing else:
{"targetSkills": [up to 3 skill names], "targetSop": a SOP name or null, "targetAgent": an agent name or null, "twinIdea": "one sentence: a different request on the same repository where the chosen capabilities would NOT help", "why": "one or two sentences"}
Use names exactly as listed.

## Task

{{TASK}}

## Catalogue

{{CATALOG}}
