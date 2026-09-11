# Asana Integration (Optional MCP)

The `asana-sprint-planning` skill uses the **official Asana V2 MCP server** — a remote HTTP server
provided by Asana, Inc. and authenticated via OAuth2. It is a user opt-in and is **not** bundled
with this package.

---

## Prerequisites

- An Asana account with access to the workspaces you want to manage.
- A registered OAuth2 application (see below).

---

## Step 1 — Register an OAuth2 application

1. Open [https://app.asana.com/0/my-apps](https://app.asana.com/0/my-apps) in your browser.
2. Click **Create new app** and fill in a name (e.g. `ASDLC Agent`).
3. Copy the **Client ID** and **Client Secret** that are displayed after creation.
   - Store the secret in your system's secure credential store — never paste it in plain text into
     config files or commit it to source control.

---

## Step 2 — Configure the MCP server

### Kiro

Add the Asana MCP server under `mcpServers` in your agent configuration file
(`~/.kiro/settings/mcp.json` or the project-level equivalent):

```json
{
  "mcpServers": {
    "asana": {
      "url": "https://mcp.asana.com/v2/mcp",
      "transport": "http",
      "auth": {
        "type": "oauth2",
        "clientId": "<your-client-id>",
        "clientSecret": "<stored-in-credential-store>"
      }
    }
  }
}
```

### Claude Code

Add the server using the Claude Code MCP configuration. The exact syntax depends on your Claude
Code version; the connection parameters are:

| Field          | Value                          |
| -------------- | ------------------------------ |
| Transport      | Remote HTTP                    |
| URL            | `https://mcp.asana.com/v2/mcp` |
| Auth type      | OAuth2                         |
| Client ID      | From step 1                    |
| Client Secret  | From step 1 (store securely)   |

Refer to the
[Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp) for
the current configuration file format.

---

## Step 3 — Verify the connection

Once configured, the `asana-sprint-planning` skill will call `asana___GetCurrentUser` at startup
to verify connectivity and retrieve your workspace GID. If the call fails, the skill will print
an error message with a link back to this guide.

---

## Full Asana MCP documentation

- Connecting MCP clients: [https://developers.asana.com/docs/connecting-mcp-clients-to-asanas-v2-server](https://developers.asana.com/docs/connecting-mcp-clients-to-asanas-v2-server)
- Asana MCP changelog and capabilities: [https://developers.asana.com/docs/mcp](https://developers.asana.com/docs/mcp)

---

## Availability

The Asana V2 MCP server is **generally available (GA)** as of 2025. The endpoint
`https://mcp.asana.com/v2/mcp` is the stable, production URL.
