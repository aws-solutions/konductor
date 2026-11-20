# T6 dropped tasks

Tasks removed from the pack after a fix round (FX job, 2026-11-20) that still failed the non-Claude recheck or a free gate. The files are not kept in the tree.

| task | writer | reason |
| --- | --- | --- |
| t6-plan-mvp-cut | deepseek-3.2 | the fix by deepseek-3.2 (hints in place of the stated answers, TEN-123 estimate blanked) still failed the gpt-5.6-luna recheck on key-matches-fixture: the reference plan's totalPoints (209) is not the sum of the chosen items plus the open TEN-123 estimate |
| t6-idea-arch-search | deepseek-3.2 | the fix by deepseek-3.2 rewrote the meeting notes, the design doc and two summaries, but the gpt-5.6-luna recheck still failed fixture-lists-no-answer: docs/quick_notes_random.md and docs/slack_chat_search_discussion.md still state the decision to start with normalization (the other three items passed) |
