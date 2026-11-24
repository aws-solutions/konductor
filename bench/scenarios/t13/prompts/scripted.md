## The scripted user: facts the agent must ask for

The colleague who wrote the request knows three facts that are NOT in the folder and NOT in the request. A careful practitioner reads the folder, sees the gap, and asks; the colleague answers; a hurried one guesses or invents a value. The facts, their topics and their answers are fixed by the brief; copy them exactly:

{{FACTS}}

Wire them in three places:
- `task-draft.json` gets `"questions": "scripted"` and `"scriptedUser": { "facts": [{ "id", "topics", "answer" }], "defaultReply": "{{DEFAULTREPLY}}" }` with the facts above, unchanged. Topics are plain lowercase words or short phrases matched as substrings of the agent's question (no regex, no bare numbers); they must not match "Is there anything else I should know before I start?".
- The request must not state, hint at or repeat any of the three answers, and must not tell the agent to ask questions.
- Each fact gets one `text` item in `blockKey` (or a `some` item when the fact lands in a list) that accepts every number and word form of the answer (for example `8 hours|8-hour|eight-hour|8h`), nothing stricter. The reference document states each fact and says it came from the colleague.
- `solution/ASKS.json`: a JSON array of 2 to 4 natural questions the reference asked, in order, that together unlock all three facts and nothing by accident. Put the same file, with that answer's own questions (or `[]` when it asked nothing), in every other answer folder you write.
