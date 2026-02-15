# Codex Orchestrator

CLI tool for delegating tasks to GPT Codex agents via tmux sessions. Designed for Claude Code orchestration with bidirectional communication.

**Stack**: TypeScript, Bun, tmux, OpenAI Codex CLI

**Structure**: Shell wrapper -> CLI entry point -> Job management -> tmux sessions

For detailed architecture, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## Development

```bash
# Run directly
bun run src/cli.ts --help

# Or via shell wrapper
./bin/codex-agent --help

# Health check
bun run src/cli.ts health
```

## Key Files

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI commands and argument parsing |
| `src/jobs.ts` | Job lifecycle and persistence |
| `src/tmux.ts` | tmux session management |
| `src/config.ts` | Configuration constants |
| `src/files.ts` | File loading for context injection |
| `src/session-parser.ts` | Parse Codex session files for metadata |
| `plugins/` | Claude Code plugin (marketplace structure) |

## Plugin Structure

This repo doubles as a Claude Code plugin marketplace:

```
.claude-plugin/marketplace.json     # marketplace registry
plugins/codex-orchestrator/         # the plugin
  .claude-plugin/plugin.json        # plugin metadata
  skills/codex-orchestrator/        # the orchestration skill
    SKILL.md                        # skill instructions
  scripts/install.sh                # dependency installer
```

## Dependencies

- **Runtime**: Bun, tmux, codex CLI
- **NPM**: glob (file matching)

## Allowed Commands

The following commands may be run without asking for user confirmation:

- `codex-agent start <prompt> [options]` - Start a new Codex agent
- `codex-agent kill <jobId>` - Kill a running agent
- `codex-agent clean` - Clean old completed jobs
- `codex-agent jobs` / `codex-agent jobs --json` - List jobs
- `codex-agent capture <jobId>` - Capture agent output
- `codex-agent status <jobId>` - Check job status
- `codex-agent health` - Health check
- `codex-agent send <jobId> <message>` - Send message to running agent
- `codex-agent report <jobId>` - Full agent report
- `codex-agent output <jobId>` - Get full session output
- `codex-agent log` - Show agents.log
- `codex-agent context` - Generate context recovery summary
- `codex-agent dashboard` - Live status dashboard
- `codex-agent claims` - Show active file claims
- `codex-agent watch <jobId>` - Stream output updates
- `codex-agent sessions` - List active tmux sessions
- `codex-agent delete <jobId>` - Delete a job
- `codex-agent attach <jobId>` - Get tmux attach command
- `sleep <seconds>` - Wait between agent checks
- `bun run typecheck` - Run TypeScript type checking
- `bun test` - Run test suite

## Notes

- Jobs stored in `~/.codex-agent/jobs/`
- Uses `script` command for output logging
- Completion detected via marker string in output
- Bun is the TypeScript runtime - never use npm/yarn/pnpm for running
