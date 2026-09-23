# Slack Integration (Optional)

The official Slack MCP server (`https://mcp.slack.com/mcp`) lets the `k-researcher` agent search
Slack channels and threads alongside web and documentation sources.

This is a **user opt-in** — the package cannot ship a shared Slack app `client_id`, so each user must
register their own Slack app. Nothing is bundled by default.

---

## Claude Code

Zero-config via the Anthropic Marketplace:

```bash
claude plugin install slack
```

That's it. Claude Code handles OAuth automatically.

---

## Kiro CLI

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a free Slack app.
2. Enable OAuth 2.0 and note your `client_id`.
3. Register the official Slack MCP server with your agent:

```bash
kiro-cli mcp add \
  --name slack \
  --url "https://mcp.slack.com/mcp" \
  --transport http-sse \
  --agent k-researcher
```

4. Authenticate when prompted (first run opens a browser for OAuth).

---

## What it enables

Once configured, `k-researcher` can:

- Search channels and DMs for prior discussions on a topic
- Pull thread context when a question has been answered internally before
- Supplement documentation findings with team knowledge

---

## Reference

- Slack MCP documentation: <https://docs.slack.dev/ai/>
- Slack app registration: <https://api.slack.com/apps>
