# `@clarift/cli`

Clarift command-line client and MCP bridge.

```powershell
$env:CLARIFT_API_TOKEN = 'clf_live_...'
clarift refine --prompt 'Plan a safe database migration'
clarift mcp --transport stdio
clarift mcp --transport http --host 127.0.0.1 --port 3210
```

The HTTP transport binds to localhost by default and enables DNS-rebinding protection. Memory mutations require explicit consent (`--yes` in the CLI or `consent: true` in MCP tool input).
