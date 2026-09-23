<!-- SPDX-License-Identifier: Apache-2.0 -->

# Getting help

[← Back to guide index](README.md)

Only channels that actually exist in this repository are listed here. Nothing on this page is
invented.

---

## First, check these

Most problems are already answered:

| Problem | Where |
| --- | --- |
| A specific error message or symptom | [Troubleshooting](troubleshooting.md) |
| "Does this work yet?" | [FAQ → what actually works today](faq.md#what-do-i-actually-get-when-i-install-konductor) |
| Unfamiliar terminology | [Glossary](glossary.md) |
| The exact command, flag, or config contract | [CLI reference](reference.md) |
| Systematic diagnosis | [Diagnose problems](tasks/diagnose-problems.md) |

Two self-service checks worth running before you ask anyone:

```bash
tail -20 ~/.konductor/logs/konductor.log
```

That gives you the exact commands you ran and the exit code each produced — much more useful in a
bug report than a recollection.

```bash
konductor doctor
```

That checks your runtime, the installed content, your project config, and whether an update is
available — and prints the fix for anything it finds.

---

## Report a bug or request a feature

Use the GitHub issue tracker, per [CONTRIBUTING.md](../../CONTRIBUTING.md):

- Open issues: <https://github.com/aws-solutions/konductor/issues>
- Recently closed: <https://github.com/aws-solutions/konductor/issues?q=is%3Aissue+is%3Aclosed>

Check both before filing — someone may have reported it already.

`CONTRIBUTING.md` asks that a bug report include:

- A reproducible test case, or a series of steps
- The version of the code being used
- Any modifications you have made that are relevant
- Anything unusual about your environment or deployment

Useful additions for Konductor specifically:

```bash
konductor --version
```

```bash
which konductor
```

```bash
cat .konductor/config.yml
```

Plus the relevant lines from `~/.konductor/logs/konductor.log`, and — if the problem is with an
agent rather than the CLI — which agent and which runtime you were using.

The repository also ships issue and PR templates in `.github/`, which your issue form will pick up
automatically.

---

## Report a security vulnerability

**Do not open a public GitHub issue for a security problem.** Per
[SECURITY.md](../../SECURITY.md), notify AWS/Amazon Security instead:

- Vulnerability reporting page: <http://aws.amazon.com/security/vulnerability-reporting/>
- Email: [aws-security@amazon.com](mailto:aws-security@amazon.com)

---

## Contribute a fix

[CONTRIBUTING.md](../../CONTRIBUTING.md) has the full process. In short:

1. Work against the latest source on the main branch.
2. Check existing and recently merged pull requests first.
3. Open an issue to discuss anything significant before writing it — so your time is not wasted.
4. Fork, make a focused change, ensure local tests pass, commit with clear messages, and send a
   pull request.
5. Watch for automated CI failures and stay in the conversation.

To run the tests before sending a change:

```bash
cargo test
```

More in [Contributing and customizing](appendix/contributing.md).

[CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) covers community standards.

---

## Documentation in this repository

| Document | Covers |
| --- | --- |
| [README.md](../../README.md) | Project overview, agent and skill summaries, roadmap |
| [AGENTS.md](../../AGENTS.md) | Instructions loaded into agent context at session start |
| [cli/README.md](../../cli/README.md) | CLI commands and conventions |
| [CHANGELOG.md](../../CHANGELOG.md) | Release notes |
| [docs/guides/getting-started-claude.md](../guides/getting-started-claude.md) | Claude Code setup, including agent-teams configuration |
| [docs/guides/slack-integration.md](../guides/slack-integration.md) | Optional Slack MCP setup for `k-researcher` |
| [docs/guides/asana-integration.md](../guides/asana-integration.md) | Optional Asana MCP setup for `k-product-manager` |

---

## External documentation

For the **runtimes** themselves, rather than Konductor:

| Tool | Where |
| --- | --- |
| Claude Code | <https://claude.ai/download> |
| Kiro | <https://kiro.dev> |
| Rust toolchain (only if building from source) | <https://www.rust-lang.org/tools/install> |
| Playwright MCP | <https://github.com/microsoft/playwright-mcp> |
| cmux | <https://github.com/manaflow-ai/cmux> |

---

## License

Konductor is licensed under the Apache License, Version 2.0. See
[LICENSE.txt](../../LICENSE.txt) and [NOTICE.txt](../../NOTICE.txt) — `NOTICE.txt` carries the
third-party dependency attributions, generated from the real Cargo dependency data.

---

[← Glossary](glossary.md) · [Back to guide index](README.md)
