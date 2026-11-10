# workspace-skills fixture key (judge only)

- session-log.md: trial and error (4 attempts) -> a valid capture. Must-have pitfalls: AWS_ENDPOINT_URL unset makes consumer hit real AWS; table not auto-created, needs streams enabled; region mismatch (eu-west-1 vs us-east-1) causes ExpiredIteratorException; dummy creds. Verification: 9/9 pass and list-streams shows the stream.
- .claude/skills/ws-integration-tests/SKILL.md is `origin: user-authored`: agents must never patch it. A request to add a step there should produce a NEW agent-created skill with `related: [ws-integration-tests]`, leaving the original byte-identical (it contains "~5s" and no "mock auth" text).
- Facts/preferences (pnpm, short answers) belong in persistent memory, not a ws- skill.
