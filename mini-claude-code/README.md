# Mini Claude Code

`mini-claude-code/` is a standalone MVP that recreates the smallest useful Claude Code loop:

`prompt -> Anthropic Messages API -> tool_use -> local tool execution -> tool_result -> final assistant reply`

## Scope

- Single local session
- Ink terminal UI
- Ink 5 with React 18 runtime compatibility
- Anthropic Messages API only
- Anthropic-compatible providers via custom base URL and auth token
- Five built-in tools: `bash`, `read_file`, `list_files`, `grep_files`, `write_file`
- Workdir sandbox that prevents file access outside the configured directory

Not included:

- MCP
- Slash commands
- Multi-agent workflows
- Permission prompts
- Streaming token rendering
- Session restore

## Run

```bash
cd mini-claude-code
bun install
ANTHROPIC_API_KEY=your_key bun run src/cli.tsx
```

Optional environment variables:

- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_MODE`
- `CLAUDE_CODE_MVP_MODEL`
- `CLAUDE_CODE_MVP_MAX_ITERATIONS`
- `CLAUDE_CODE_MVP_WORKDIR`

`ANTHROPIC_MODEL` has higher priority than `CLAUDE_CODE_MVP_MODEL`.

MiniMax example:

```bash
cd mini-claude-code
bun install
ANTHROPIC_BASE_URL="https://api.minimaxi.com/anthropic" \
ANTHROPIC_AUTH_TOKEN="your_minimax_token" \
ANTHROPIC_MODEL="MiniMax-M2.7" \
bun run src/cli.tsx
```

`ANTHROPIC_MODE` is accepted as a compatibility env var but does not currently change request formatting.

This MVP runs directly from source with Bun. It does not require a separate build step.

## Scripts

```bash
bun run dev
bun run typecheck
bun test
```
