---
name: codex-orchestrator
description: DEFAULT PIPELINE for all tasks requiring execution. You (Claude) are the strategic orchestrator. Codex agents are your implementation army - hyper-focused coding specialists. Trigger on ANY task involving code, file modifications, codebase research, multi-step work, or implementation. This is NOT optional - Codex agents are the default for all execution work. Only skip if the user explicitly asks you to do something yourself.
triggers:
  - codex-orchestrator
  - spawn codex
  - use codex
  - delegate to codex
  - start agent
  - codex agent
  - init
  - setup codex
---

# Codex Orchestrator

## The Command Structure

```
USER - directs the mission
    |
    ├── CLAUDE #1 (Opus) --- General
    |       ├── CODEX agent
    |       ├── CODEX agent
    |       └── CODEX agent ...
    |
    ├── CLAUDE #2 (Opus) --- General
    |       ├── CODEX agent
    |       └── CODEX agent ...
    |
    ├── CLAUDE #3 (Opus) --- General
    |       └── CODEX agent ...
    |
    └── CLAUDE #4 (Opus) --- General
            └── CODEX agent ...
```

**The user is in command.** They set the vision, make strategic decisions, approve plans. They can direct multiple Claude instances simultaneously.

**You (Claude) are their general.** You command YOUR Codex army on the user's behalf. You are in FULL CONTROL of your agents:
- You decide which agents to spawn
- You decide what tasks to give them
- You coordinate your agents working in parallel
- You course-correct or kill agents as needed
- You synthesize your army's work into results for the user

The user can run 4+ Claude instances in parallel. Each Claude has its own Codex army. This is how massive codebases get built in days instead of weeks.

You handle the strategic layer. You translate the user's intent into actionable commands for YOUR army.

**Codex agents are the army under your command.** Hyper-focused coding specialists. Extremely thorough and effective in their domain - they read codebases deeply, implement carefully, and verify their work. They get the job done right.

Codex reports to you. You report to the user.

### CRITICAL RULES

#### Rule 1: Hard Delegation Boundary

If a task involves reading source files, analyzing code, modifying files, researching the codebase, testing, security auditing, or any code-related conclusion, you MUST delegate the execution/analysis to codex-agent.

You MAY read directly:
- agents.log (for coordination state)
- PRD documents you wrote yourself
- User-pasted code snippets in the conversation
- Up to one repository file for conversational context

All multi-file analysis MUST go through Codex agents.

You must NOT:
- Perform multi-file source analysis yourself
- Make technical claims without citing codex-agent job IDs and capture output

If codex-agent is unavailable after health check, STOP and report blocked. Do not fall back to self-implementation unless the user explicitly says 'do it yourself'.

#### Rule 2: Evidence Requirement

Every technical conclusion must cite source job IDs. Use `codex-agent capture <id>` output as evidence. No uncited codebase claims.

#### Rule 3: First Action Must Be Delegation

For any code/file task, your first execution action must be spawning a codex-agent. Discuss strategy with the user first, then delegate immediately.

## Prerequisites

Before codex-agent can run, three things must be installed:

1. **tmux** - Terminal multiplexer (agents run in tmux sessions)
2. **Bun** - JavaScript runtime (runs the CLI)
3. **OpenAI Codex CLI** - The coding agent being orchestrated

The user must also be **authenticated with OpenAI** (`codex --login`) so agents can make API calls.

### Quick Check

```bash
codex-agent health    # checks tmux + codex are available
```

### If Not Installed

If the user says "init", "setup", or codex-agent is not found, **run the install script**:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install.sh"
```

**Always use the install script.** Do NOT manually check dependencies or try to install things yourself step-by-step. The script handles everything: detects the platform, checks each dependency, installs what's missing via official package managers, clones the repo, and adds `codex-agent` to PATH. Linux installs may require sudo depending on package manager.

If `${CLAUDE_PLUGIN_ROOT}` is not available (manual skill install), the user can run:

```bash
bash ~/.codex-orchestrator/plugins/codex-orchestrator/scripts/install.sh
```

After installation, the user must authenticate with OpenAI if they haven't already:

```bash
codex --login
```

**All dependencies use official sources only.** tmux from system package managers, Bun from bun.sh, Codex CLI from npm. No third-party scripts or unknown URLs.

## Pipeline Modes

### Choosing the Right Pipeline

Not every task needs the full 7-step pipeline. Choose based on complexity:

| Complexity | Pipeline | Flow | When to use |
|-----------|----------|------|-------------|
| **Simple** | **Simple (1 agent)** | Single Codex implementation agent with verification | Bug fixes, single-file changes |
| **Medium** | **Standard (3 steps)** | Research -> Implement -> Review | Multi-file changes, scoped features, refactors |
| **Complex** | **Full (7 steps)** | Ideation -> Research -> Synthesis -> PRD -> Implement -> Review -> Test | Architecture changes, new systems, large features |

**Auto-detect complexity:**
- Single file mentioned + clear fix = **Simple**
- Multiple files or "add feature" with clear scope = **Standard**
- "refactor", "redesign", "new system", PRD needed = **Full**

### Simple Pipeline (1 Agent)

```
USER'S REQUEST
     |
     v
1. IMPLEMENT + VERIFY   (Codex, workspace-write)
```

Use for: bug fixes and clear single-file changes.
Instruct the single agent to implement, run typecheck/tests, and self-review before reporting.

### Standard Pipeline (3 Steps)

```
USER'S REQUEST
     |
     v
1. RESEARCH         (Codex, read-only)
     |
2. IMPLEMENTATION   (Codex, workspace-write)
     |
3. REVIEW           (Codex, read-only)
```

Use for: multi-file feature work, refactors with clear scope, and most day-to-day delivery tasks.

### The Full Factory Pipeline

```
USER'S REQUEST
     |
     v
1. IDEATION        (You + User)
     |
2. RESEARCH         (Codex, read-only)
     |
3. SYNTHESIS        (You)
     |
4. PRD              (You + User)
     |
5. IMPLEMENTATION   (Codex, workspace-write)
     |
6. REVIEW           (Codex, read-only)
     |
7. TESTING          (Codex, workspace-write)
```

**You** handle stages 1, 3, 4 - the strategic work.
**Codex agents** handle stages 2, 5, 6, 7 - the execution work.

### Pipeline Stage Detection

Detect where you are based on context:

| Signal | Pipeline/Stage | Action |
|--------|----------------|--------|
| Single-file bug fix, explicit change request | SIMPLE | Spawn one workspace-write agent with implementation + verification requirements |
| New feature request, vague problem | FULL / IDEATION | Discuss with user, clarify scope |
| "investigate", "research", "understand" | STANDARD or FULL / RESEARCH | Spawn read-only Codex agents |
| Agent findings ready, need synthesis | FULL / SYNTHESIS | You review, filter, combine |
| "let's plan", "create PRD", synthesis done | FULL / PRD | You write PRD to docs/prds/ |
| PRD exists, "implement", "build" | STANDARD or FULL / IMPLEMENTATION | Spawn workspace-write Codex agents |
| Implementation done, "review" | STANDARD or FULL / REVIEW | Spawn review Codex agents |
| "test", "verify", review passed | FULL / TESTING | Spawn test-writing Codex agents |

## Core Principles

1. **Gold Standard Quality** - No shortcuts. Security, proper patterns, thorough testing - all of it.
2. **Always Interactive** - Prefer sending messages to redirect agents. Only kill as last resort after a confirmed stuck state (no output changes for 10+ minutes despite send attempts).
3. **Parallel Execution** - Multiple Claude instances can spawn multiple Codex agents simultaneously.
4. **Codebase Map Always** - Every agent gets `--map` for context.
5. **PRDs Drive Implementation** - Complex changes get PRDs in docs/prds/.
6. **Patience is Required** - Agents take time. This is normal and expected.

## Definition of Done (Quality Checklists)

Every pipeline stage has explicit completion criteria. Inject these into agent prompts.

### Research Stage — Done When:
- [ ] All relevant files identified and read
- [ ] Architecture/data flow documented
- [ ] Risks and edge cases noted
- [ ] Findings written to agents.log

### Implementation Stage — Done When:
- [ ] TypeScript compiles without errors (`bun run typecheck` or `tsc --noEmit`)
- [ ] No `any` types introduced
- [ ] All API calls have error handling
- [ ] Existing tests still pass
- [ ] New functionality has at least one test
- [ ] No hardcoded secrets or credentials
- [ ] Changes follow existing code patterns/conventions

### Review Stage — Done When:
- [ ] OWASP top 10 checked (XSS, injection, auth bypass)
- [ ] Error handling reviewed (no swallowed errors)
- [ ] Data integrity verified (no accidental deletion/corruption)
- [ ] Performance impact assessed
- [ ] Findings documented

### Testing Stage — Done When:
- [ ] Unit tests for new functions/methods
- [ ] Edge cases covered (empty input, null, boundaries)
- [ ] All tests pass
- [ ] No flaky tests introduced

### Quality Prompt Templates

When spawning implementation agents, include these quality requirements in the prompt:

**For Implementation agents:**
```
QUALITY REQUIREMENTS (mandatory):
1. TypeScript must compile without errors
2. No `any` types - use proper typing
3. All external API calls must have try/catch with meaningful error messages
4. Run existing tests before and after changes - they must pass
5. Add at least one test for new functionality
6. Follow the existing code style and patterns in this codebase
7. No hardcoded secrets, API keys, or credentials
```

**For Review agents:**
```
REVIEW CHECKLIST (check all):
1. Security: OWASP top 10 vulnerabilities (XSS, injection, auth bypass, CSRF)
2. Error handling: No swallowed errors, proper error messages, consistent patterns
3. Data integrity: No accidental data loss, proper validation, safe migrations
4. Performance: No N+1 queries, no unbounded loops, proper pagination
5. Code quality: Follows project conventions, no dead code, proper naming
Report each item as PASS/FAIL with explanation.
```

## Agent Timing Expectations (CRITICAL - READ THIS)

**Codex agents take time. This is NORMAL. Do NOT be impatient.**

| Task Type | Typical Duration |
|-----------|------------------|
| Simple research | 10-20 minutes |
| Implementation (single feature) | 20-40 minutes |
| Complex implementation | 30-60+ minutes |
| Full PRD implementation | 45-90+ minutes |

**Why agents take this long:**
- They read the codebase thoroughly (not skimming)
- They think deeply about implications
- They implement carefully with proper patterns
- They verify their work (typecheck, tests)
- They handle edge cases

**When you keep talking to an agent via `codex-agent send`**, it stays open and continues working. Sessions can extend to 60+ minutes easily - and that is FINE. A single agent that you course-correct is often better than killing and respawning.

**Do NOT:**
- Kill agents just because they have been running for 20 minutes
- Assume something is wrong if an agent runs for 30+ minutes
- Spawn new agents to replace ones that are "taking too long"
- Ask the user "should I check on the agent?" after 15 minutes

**DO:**
- Check progress with `codex-agent capture <id>` periodically
- Send clarifying messages if the agent seems genuinely stuck
- Let agents finish their work - they are thorough for a reason
- Trust the process - quality takes time

## Codebase Map: Giving Agents Instant Context

The `--map` flag is the most important flag you'll use. It injects `docs/CODEBASE_MAP.md` into the agent's prompt - a comprehensive architecture document that gives agents instant understanding of the entire codebase: file purposes, module boundaries, data flows, dependencies, conventions, and navigation guides.

**Without a map**, agents waste time exploring and guessing at structure.
**With a map**, agents know exactly where things are and how they connect. They start working immediately instead of orienteering.

The map is generated by [Cartographer](https://github.com/dennishalvorsen/cartographer), a separate Claude Code plugin that scans your codebase with parallel subagents and produces the map:

```
/plugin marketplace add dennishalvorsen/cartographer
/plugin install cartographer
/cartographer
```

This creates `docs/CODEBASE_MAP.md`. After that, every `codex-agent start ... --map` command gives agents full architectural context.

**Always generate a codebase map before using codex-orchestrator on a new project.** It's the difference between agents that fumble around and agents that execute with precision.

## CLI Defaults

The CLI ships with strong defaults so most commands need minimal flags:

| Setting | Default | Why |
|---------|---------|-----|
| Model | `gpt-5.3-codex` | Latest and most capable Codex model |
| Reasoning | `xhigh` | Maximum reasoning depth - agents think deeply |
| Sandbox | `workspace-write` | Agents can modify files by default |

You almost never need to override these. The main flags you'll use are `--map` (include codebase context), `-s read-only` (for research tasks), and `-f` (include specific files).

## CLI Reference

### Spawning Agents

```bash
# Research (read-only - override sandbox)
codex-agent start "Investigate auth flow for vulnerabilities" --map -s read-only

# Implementation (defaults are perfect - xhigh reasoning, workspace-write)
codex-agent start "Implement the auth refactor per PRD" --map

# With file context
codex-agent start "Review these modules" --map -f "src/auth/**/*.ts" -f "src/api/**/*.ts"
```

### Monitoring Agents

```bash
# Single job details
codex-agent status <jobId>

# Structured status - tokens, files modified, summary
codex-agent jobs --json

# Human readable table
codex-agent jobs

# Active tmux sessions
codex-agent sessions

# Recent output
codex-agent capture <jobId>
codex-agent capture <jobId> 200    # more lines

# Full output
codex-agent output <jobId>

# Live stream
codex-agent watch <jobId>
```

### Communicating with Agents

```bash
# Send follow-up message
codex-agent send <jobId> "Focus on the database layer"
codex-agent send <jobId> "The dependency is installed. Run bun run typecheck"

# Get tmux attach command for this job
codex-agent attach <jobId>

# Direct tmux attach (for full interaction)
tmux attach -t codex-agent-<jobId>
# Ctrl+B, D to detach
```

**IMPORTANT**: Use `codex-agent send`, not raw `tmux send-keys`. The send command handles escaping and timing properly.

### Control

```bash
codex-agent kill <jobId>           # stop agent (last resort)
codex-agent delete <jobId>         # delete specific job metadata + logs
codex-agent clean                  # remove old jobs (>7 days)
codex-agent health                 # verify codex + tmux + agent heartbeats
```

### Reports & Context

```bash
codex-agent report <jobId>         # full report: diff stats, tokens, errors, summary
codex-agent log                    # show agents.log from project root
codex-agent context                # generate context recovery summary (use after compaction)
codex-agent dashboard              # live terminal dashboard of all agents
```

### Coordination

```bash
# Claim files to prevent multi-agent conflicts
codex-agent start "Implement auth" --map --claim "src/auth/**"
codex-agent claims                 # show active file claims

# Limit context injection size
codex-agent start "Fix bug" -f "src/**/*.ts" --context-budget 5000

# Auto-retry on failure
codex-agent start "Implement feature" --map --retry 2
```

## Flags Reference

| Flag | Short | Values | Description |
|------|-------|--------|-------------|
| `--reasoning` | `-r` | low, medium, high, xhigh | Reasoning depth |
| `--sandbox` | `-s` | read-only, workspace-write, danger-full-access | File access level |
| `--file` | `-f` | glob | Include files (repeatable) |
| `--map` | | flag | Include docs/CODEBASE_MAP.md |
| `--dir` | `-d` | path | Working directory |
| `--parent-session` | | id | Parent session ID for linkage |
| `--model` | `-m` | string | Model override |
| `--json` | | flag | JSON output (jobs only) |
| `--limit` | | n | Limit jobs shown (jobs only) |
| `--all` | | flag | Show all jobs including old ones |
| `--strip-ansi` | | flag | Clean output |
| `--dry-run` | | flag | Preview prompt without executing |
| `--claim` | | glob | Claim file ownership (repeatable) |
| `--context-budget` | | number | Max tokens for file context |
| `--retry` | | number | Auto-retry count on failure |

## Jobs JSON Output

```json
{
  "generated_at": "2026-01-21T10:45:00.000Z",
  "jobs": [
    {
      "id": "8abfab85",
      "status": "completed",
      ...
    }
  ]
}
```

## Pipeline Stages in Detail

### Stage 1: Ideation (You + User)

Talk through the problem with the user. Understand what they want. Think about how to break it down for the Codex army.

**Your role here**: Strategic thinking, asking clarifying questions, proposing approaches.

Even seemingly simple tasks go to Codex agents - remember, you are the orchestrator, not the implementer. The only exception is if the user explicitly asks you to do it yourself.

### Stage 2: Research (Codex Agents - read-only)

Spawn parallel investigation agents:

```bash
codex-agent start "Map the data flow from API to database for user creation" --map -s read-only
codex-agent start "Identify all places where user validation occurs" --map -s read-only
codex-agent start "Find security vulnerabilities in user input handling" --map -s read-only
```

Log each spawn immediately in agents.log.

### Stage 3: Synthesis (You)

Review agent findings. This is where you add value as the orchestrator:

**Filter bullshit from gold:**
- Agent suggests splitting a 9k token file - likely good
- Agent suggests adding rate limiting - good, we want quality
- Agent suggests types for code we didn't touch - skip, over-engineering
- Agent contradicts itself - investigate further
- Agent misunderstands the codebase - discount that finding

**Combine insights:**
- What's the actual state of the code?
- What are the real problems?
- What's the right approach?

Write synthesis to agents.log.

### Stage 4: PRD Creation (You + User)

For significant changes, create PRD in `docs/prds/`:

```markdown
# [Feature/Fix Name]

## Problem
[What's broken or missing]

## Solution
[High-level approach]

## Requirements
- [Specific requirement 1]
- [Specific requirement 2]

## Implementation Plan
### Phase 1: [Name]
- [ ] Task 1
- [ ] Task 2

### Phase 2: [Name]
- [ ] Task 3

## Files to Modify
- path/to/file.ts - [what changes]

## Testing
- [ ] Unit tests for X
- [ ] Integration test for Y

## Success Criteria
- [How we know it's done]
```

Review PRD with user before implementation.

### Stage 5: Implementation (Codex Agents - workspace-write)

Spawn implementation agents with PRD context:

```bash
codex-agent start "Implement Phase 1 of docs/prds/auth-refactor.md. Read the PRD first." --map -f "docs/prds/auth-refactor.md"
```

For large PRDs, implement in phases with separate agents. If multiple write agents are active, each must use a separate `--dir`.

### Stage 6: Review (Codex Agents - read-only)

Spawn parallel review agents:

```bash
# Security review
codex-agent start "Security review the changes. Check:
- OWASP top 10 vulnerabilities
- Auth bypass possibilities
- Data exposure risks
- Input validation
- SQL/command injection
Report any security concerns." --map -s read-only

# Error handling review
codex-agent start "Review error handling in changed files. Check for:
- Swallowed errors
- Missing validation
- Inconsistent patterns
- Raw errors exposed to clients
Report any violations." --map -s read-only

# Data integrity review
codex-agent start "Review for data integrity. Check:
- Existing data unaffected
- Database queries properly scoped
- No accidental data deletion
- Migrations are additive/safe
Report any concerns." --map -s read-only
```

**After review agents complete:**
- Synthesize findings
- Fix any critical issues before commit
- Note non-critical issues for future

### Stage 7: Testing (Codex Agents - workspace-write)

```bash
# Write tests
codex-agent start "Write comprehensive tests for the auth module changes" --map --dir ./branch-tests

# Run verification
codex-agent start "Run typecheck and tests. Fix any failures." --map --dir ./branch-verify
```

## Scaling: Multiple Claude Instances

The real power of this system is parallelism at every level:

```
USER runs 4 Claude instances simultaneously
  |
  Claude #1: researching auth module     (3 Codex agents)
  Claude #2: implementing feature A      (2 Codex agents)
  Claude #3: reviewing recent changes    (4 Codex agents)
  Claude #4: writing tests               (2 Codex agents)
```

When running multiple Claude Code sessions on the same codebase:
1. Each Claude instance spawns and manages its own agents independently
2. All instances share the same `agents.log` for coordination
3. Use job IDs to track which agent belongs to which Claude instance
4. Coordinate via agents.log entries to avoid duplicate work
5. Each Claude should claim a stage or module to prevent conflicts

This is how you get exponential execution: N Claude instances x M Codex agents each = N*M parallel workers on your codebase.

**Parallel Isolation Warning**: If running multiple write agents, each MUST use a separate working directory with `--dir`. Never run multiple write agents in the same worktree.

## agents.log Format

Maintain in project root. Shared across all Claude instances.

```markdown
# Agents Log

## Session: 2026-01-21T10:30:00Z
Goal: Refactor authentication system
PRD: docs/prds/auth-refactor.md

### Spawned: abc123 - 10:31
Type: research
Prompt: Investigate current auth flow, identify security gaps
Reasoning: xhigh
Sandbox: read-only

### Spawned: def456 - 10:31
Type: research
Prompt: Analyze session management patterns
Reasoning: xhigh
Sandbox: read-only

### Complete: abc123 - 10:45
Findings:
- JWT tokens stored in localStorage (XSS risk)
- No refresh token rotation
- Missing rate limiting on login endpoint
Files: src/auth/jwt.ts, src/auth/session.ts

### Complete: def456 - 10:47
Findings:
- Sessions never expire
- No concurrent session limits
Files: src/auth/session.ts, src/middleware/auth.ts

### Synthesis - 10:50
Combined: Auth system has 4 critical issues:
1. XSS-vulnerable token storage
2. No token rotation
3. No rate limiting
4. Infinite sessions
Approach: Create PRD with phased fix
Next: Write PRD to docs/prds/auth-security-hardening.md
```

## Multi-Agent Patterns

### Parallel Investigation

```bash
# Spawn 3 research agents simultaneously
codex-agent start "Audit auth flow" --map -s read-only
codex-agent start "Review API security" --map -s read-only
codex-agent start "Check data validation" --map -s read-only

# Check all at once
codex-agent jobs --json
```

### Sequential Implementation

```bash
# Phase 1
codex-agent start "Implement Phase 1 of PRD" --map --dir ./branch-phase1
# Wait for completion, review
codex-agent jobs --json

# Phase 2 (after Phase 1 verified)
codex-agent start "Implement Phase 2 of PRD" --map --dir ./branch-phase2
```

## Quality Gates

Before marking any stage complete, verify against the Definition of Done checklists above:

| Stage | Gate | Verification |
|-------|------|--------------|
| Research | Findings documented in agents.log | `codex-agent log` |
| Synthesis | Clear understanding, contradictions resolved | You review findings |
| PRD | User reviewed and approved | User confirmation |
| Implementation | Typecheck passes, no new errors, tests pass | `codex-agent report <id>` |
| Review | Security + quality checks pass, all items PASS | `codex-agent report <id>` |
| Testing | Tests written and passing | `codex-agent report <id>` |

## Error Recovery

### Agent Stuck

```bash
codex-agent jobs --json           # check status
codex-agent capture <jobId> 100   # see what's happening
codex-agent send <jobId> "Status update - what's blocking you?"
# wait, then re-check for output change
codex-agent capture <jobId> 100
codex-agent send <jobId> "Give blockers and next concrete step."
codex-agent kill <jobId>          # last resort: no output change for 10+ minutes despite send attempts
```

### Agent Didn't Get Message

If `codex-agent send` doesn't seem to work:
1. Check agent is still running: `codex-agent jobs --json`
2. Agent might be "thinking" - wait a moment
3. Try sending again with clearer instruction
4. Attach directly: `tmux attach -t codex-agent-<jobId>`

### Implementation Failed

1. Check the error in output
2. Don't retry with the same prompt
3. Mutate the approach - add context about what failed
4. Consider splitting into smaller tasks

## Post-Compaction Recovery

After Claude's context compacts, immediately:

```bash
# Generate full context recovery summary
codex-agent context

# Check agents.log for state
codex-agent log

# Check running agents with structured data
codex-agent jobs --json

# Get detailed report for any completed agent
codex-agent report <jobId>
```

The `context` command generates a complete summary of all running, completed, and failed agents plus recent agents.log entries. This gives you everything needed to resume from where you left off.

During recovery, you may read up to one file directly for conversational context. Keep all multi-file investigation in codex-agent capture/output flows.

## When NOT to Use This Pipeline

Basically never. Codex agents are the default for all execution work.

**The ONLY exceptions:**
- The user explicitly says "you do it" or "don't use Codex"
- Pure conversation/discussion (no code, no files)
- You need to read up to one file to understand conversational context

**Everything else goes to Codex agents**, including:
- "Simple" single file changes
- "Quick" bug fixes
- Tasks you think you could handle yourself

Why? Because:
1. Your job is orchestration, not implementation
2. Codex agents are specialized for coding work
3. This frees you to continue strategic discussion with the user
4. It's more efficient - agents work while you talk
