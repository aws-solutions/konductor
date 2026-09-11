---
name: external-research
description: Search external documentation, web resources, and best practices. Use when gathering information about open-source libraries, AWS services, industry patterns, or external tools.
version: 1.0.0
tags: [skill, research, external, web, documentation, best-practices]
---

# External Research

## Overview

Guides systematic searching of external resources — official documentation, open-source repositories, and industry best practices. Ensures findings are reliable, current, and properly cited.

## Usage

Use this skill when you need to:

- Look up AWS service documentation, limits, or pricing
- Research open-source library APIs, patterns, or known issues
- Find industry best practices or design patterns
- Evaluate third-party tools or frameworks

Do NOT use for private or authenticated resources that require credentialed access.

## Tools

Use `WebFetch` to retrieve content from a known URL. When no URL is known, use `WebSearch` to find relevant public and internal sources, then `WebFetch` the pages identified.

## Search Strategy

1. **Start broad, then narrow** — begin with official docs, then drill into specifics
2. **Cross-reference multiple sources** — never rely on a single blog post or answer
3. **Prefer official docs over community content** — blogs and forums may be outdated or wrong
4. **Check version relevance** — ensure docs match the version you're actually using
5. **Note recency** — flag if content is older than 12 months for fast-moving technologies

## Source Reliability

Ranked from most to least reliable:

| Tier | Source                                          | Trust Level                    |
| ---- | ----------------------------------------------- | ------------------------------ |
| 1    | Official documentation (AWS docs, library docs) | High — authoritative           |
| 2    | GitHub repos (source code, issues, changelogs)  | High — primary source          |
| 3    | Stack Overflow (highly voted, accepted answers) | Medium — verify independently  |
| 4    | Blog posts, tutorials, Medium articles          | Low — cross-reference required |

Always prefer Tier 1–2 sources. Use Tier 3–4 only to supplement or when higher-tier sources lack coverage.

## Output Format

1. **Cite URLs** — include the full URL for every finding
2. **Summarize key findings** — extract actionable insights, not full page content
3. **Note version and date** — include the library/service version and when the source was published
4. **Flag conflicts** — if sources disagree, present both sides with reliability tiers
5. **State applicability** — note any caveats about environment, version, or scale

Example:

```
### Finding: S3 Event Notifications support SQS FIFO queues (since Nov 2023)
- **Source:** https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html
- **Version:** Current (verified May 2025)
- **Confidence:** High (official AWS docs)
```

## Quality Gate

**CRITICAL:**

- Presenting information without citing the source URL
- Using Tier 4 sources as sole evidence for architectural decisions

**IMPORTANT:**

- Not checking version relevance for library/framework guidance
- Not cross-referencing when sources conflict

**SUGGESTION:**

- Could include additional alternative approaches from different sources
- Could note when a technology is changing rapidly and findings may become stale

## Optional: Official Slack MCP

Optional: the researcher can also search Slack via the official Slack MCP — see `docs/guides/slack-integration.md` for setup.
