# Notes for AI (MCP)

## Connection

The MCP (Model Context Protocol) server is **off by default** and **listens on `127.0.0.1` only**. Clients must present a valid `Authorization: Bearer <token>` header for every request.

### URL

```
http://127.0.0.1:<port>/mcp
```

The port defaults to **27124**. If you changed the port in settings, use that port instead.

### Authorization Header

```
Authorization: Bearer <token>
```

The token is generated when you first enable MCP. You can also use `mcp:regen-token` to generate a new token.

### Read-only Mode

By default, the vault is **read-only** for AI access. This means the AI can:

- **Search** notes
- **Read** notes
- **List** notes
- **Get backlinks**

The AI **cannot**:
- Append to notes
- Create new notes
- Modify any vault files

To enable write access, disable "Read-only (AI can search and read, not edit)" in the MCP settings. Write operations will only succeed if the vault is open in **notes mode** (not code mode, which is always read-only).

## Tools List

When connected, the AI can call these tools (via JSON-RPC 2.0 MCP protocol):

| Tool | Description | Read-only |
|------|-------------|-----------|
| `search` | Search notes with a query string | Yes |
| `get_note` | Read a note by path | Yes |
| `list_notes` | List all notes in the vault | Yes |
| `backlinks` | Get backlinks for a note path | Yes |
| `append_note` | Append text to a note | No |
| `create_note` | Create a new note | No |

When the vault is read-only, `tools/list` will only include `search`. Calling write tools (`append_note`, `create_note`) returns an error: `"Vault is read-only for AI access"`.

## Example Config for OpenCode (`opencode.json`)

```json
{
  "mcpServers": {
    "nexus-vault": {
      "type": "http",
      "url": "http://127.0.0.1:27124/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

Replace `<token>` with the actual token value, or use the placeholder and have the system fill it in.

## Example Config for Generic MCP Clients

```json
{
  "mcpServers": {
    "nexus-vault": {
      "type": "http",
      "url": "http://127.0.0.1:27124/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

## How to Connect

1. **Enable MCP** in the vault menu → "AI access (MCP)…" → toggle "Enabled"
2. **Generate a token** (or use the default)
3. **Configure your AI client** with the URL and Bearer token
4. **Start asking questions** about your notes

## Security

- MCP only listens on `127.0.0.1` (localhost) — never expose it to public networks
- Every request must include `Authorization: Bearer <token>`
- The token is cryptographically random (32 bytes base64url)
- Read-only mode is the default — enable write access only if you trust the AI client
- The server stops automatically when the application quits
- No personal emails or names are stored or transmitted