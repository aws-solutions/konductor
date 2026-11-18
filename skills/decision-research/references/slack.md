Read this when the user gives Slack thread URLs or asks you to search Slack for prior discussion of a decision.

# Slack Discussion Context

**Reading a specific thread:**

- Use your Slack MCP integration's thread-replies tool with the Slack URL to read the full conversation
- Use your Slack MCP integration's user-lookup tool to resolve Slack user IDs to real names; never use raw IDs in findings
- Use your Slack MCP integration's channel-info tool to get channel name and context

**Searching for related discussions:**

- Use `search` with topic keywords to find relevant Slack conversations
- Combine with channel filters (e.g., `in:#architecture-reviews`) for precision
- Read the top results via your Slack MCP integration's thread-replies tool for full context

**What to extract from threads:**

- The core question or problem being discussed
- Each participant's position and their reasoning
- Arguments for and against each position (with attribution)
- Constraints or requirements mentioned
- Consensus points and unresolved tensions
- Links or references shared in the thread
- Timeline context (when was this discussed, is it still relevant?)

**Mapping thread content to the Research Output Template in `SKILL.md`:**

| Thread element        | Maps to                                                      |
| --------------------- | ------------------------------------------------------------ |
| Positions taken       | Alternatives, with each argument and who made it as evidence |
| Participants          | The attribution on each Alternatives entry                   |
| Consensus points      | Prior Decisions, linking the thread                          |
| Unresolved tensions   | Gaps                                                         |
| Constraints mentioned | Constraints                                                  |
| Links shared          | Sources                                                      |

