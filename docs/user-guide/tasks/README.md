<!-- SPDX-License-Identifier: Apache-2.0 -->

# Task guides

[← Back to guide index](../README.md)

One page per real task. Each gives numbered steps, the expected output after each command, and a
checkpoint so you know whether it worked. Where behaviour differs between a fresh install and an
existing one, the page says so.

Looking to change how the agents behave, or build the CLI yourself? That is
[Contributing and customizing](../appendix/contributing.md).

| Task | What you get |
| --- | --- |
| [Install for Kiro CLI](install-kiro-cli.md) | The agent team registered with `kiro-cli` |
| [Install for Claude Code](install-claude-code.md) | The agent team registered with `claude`, including the two settings agent teams require |
| [Initialize a project](initialize-a-project.md) | A `.konductor/` directory with a starter config |
| [Diagnose problems](diagnose-problems.md) | `konductor doctor`, plus manual checks for behaviour it cannot see |
| [Update an installation](update.md) | The latest release, with your local modifications kept |
| [Uninstall](uninstall.md) | Konductor removed from your machine |

---

## Which task do I want?

```mermaid
%%{init:{'theme':'base','themeVariables':{'fontSize':'14px','primaryColor':'#eef2f7','primaryTextColor':'#0f172a','primaryBorderColor':'#40556e','lineColor':'#7a8899','textColor':'#0f172a','edgeLabelBackground':'#ffffff','clusterBkg':'#fafbfc','clusterBorder':'#c9d2dc'}}}%%
flowchart TD
    Start([What are you trying to do?])

    Start --> A{First time?}

    A -->|Yes| B{Which runtime?}
    B -->|Kiro CLI| K["install-kiro-cli.md"]
    B -->|Claude Code| C["install-claude-code.md"]
    K --> E["initialize-a-project.md"]
    C --> E

    A -->|"No, something is broken"| H["diagnose-problems.md"]
    H --> I["../troubleshooting.md"]

    A -->|"No, managing an install"| J{Which?}
    J -->|Update| L["update.md"]
    J -->|Remove| M["uninstall.md"]
```

*Routing to the right task guide.*

---

[← Back to guide index](../README.md)
