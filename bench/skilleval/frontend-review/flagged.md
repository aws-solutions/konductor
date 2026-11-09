# Rules flagged for owner review: frontend-review

Panel: gpt-5.6-luna, deepseek-3.2, glm-5. Votes are worth/style per judge (Y or n).

| Rule | Tag | Votes | Vote result | Flags | Rule text |
| --- | --- | --- | --- | --- | --- |
| R04 | useful | gpt-5.6-luna: Y/n; deepseek-3.2: Y/n; glm-5: n/n | keep | split on worth (2 of 3) | The answer must recommend Zod for validation, not manual validation approaches. |
| R05 | useful | gpt-5.6-luna: Y/n; deepseek-3.2: Y/n; glm-5: n/n | keep | split on worth (2 of 3) | The answer must recommend using Box instead of div or span elements. |
| R06 | useful | gpt-5.6-luna: Y/n; deepseek-3.2: Y/n; glm-5: n/n | keep | split on worth (2 of 3) | The answer must recommend using SpaceBetween for spacing between elements. |
| R09 | useful | gpt-5.6-luna: n/n; deepseek-3.2: Y/n; glm-5: n/n | drop | split on worth (1 of 3) | The answer must recommend memoizing event handlers with useCallback. |
| R10 | useful | gpt-5.6-luna: n/n; deepseek-3.2: Y/n; glm-5: Y/n | keep | split on worth (2 of 3) | The answer must recommend using imperative array building for 3 or more conditional items, not ternary chains. |

Record a decision in owner-decisions.json as {"R03": "keep", "R07": "drop", "R09": {"decision": "keep", "bucket": "format"}} and run vote again (cached, no cost).
