#!/usr/bin/env bun

// Codex Agent CLI - Delegate tasks to GPT Codex agents with tmux integration
// Designed for Claude Code orchestration with bidirectional communication

import { config, ReasoningEffort, SandboxMode } from "./config.ts";
import {
  startJob,
  loadJob,
  listJobs,
  killJob,
  refreshJobStatus,
  cleanupOldJobs,
  deleteJob,
  sendToJob,
  sendControlToJob,
  getJobOutput,
  getJobFullOutput,
  getAttachCommand,
  Job,
  getJobsJson,
} from "./jobs.ts";
import { loadFiles, formatPromptWithFiles, estimateTokens, loadCodebaseMap } from "./files.ts";
import { isTmuxAvailable, listSessions, heartbeat } from "./tmux.ts";
import { readAgentLog, generateContextSummary } from "./agent-log.ts";
import { extractSessionId, findSessionFile, generateSessionReport } from "./session-parser.ts";
import { listClaims, cleanStaleClaims } from "./claims.ts";
import { runDashboard } from "./dashboard.ts";
import { readFileSync } from "fs";
import { join } from "path";

const HELP = `
Codex Agent - Delegate tasks to GPT Codex agents (tmux-based)

Usage:
  codex-agent start "prompt" [options]   Start agent in tmux session
  codex-agent status <jobId>             Check job status
  codex-agent send <jobId> "message"     Send message to running agent
  codex-agent capture <jobId> [lines]    Capture recent output (default: 50 lines)
  codex-agent output <jobId>             Get full session output
  codex-agent attach <jobId>             Get tmux attach command
  codex-agent watch <jobId>              Stream output updates
  codex-agent jobs [--json]              List all jobs
  codex-agent sessions                   List active tmux sessions
  codex-agent kill <jobId>               Kill running job
  codex-agent clean                      Clean old completed jobs
  codex-agent health                     Check tmux and codex availability
  codex-agent report <jobId>             Full agent report with diff stats
  codex-agent log                        Show agents.log
  codex-agent context                    Generate context recovery summary
  codex-agent claims                     Show active file claims
  codex-agent dashboard                  Live status dashboard

Options:
  -r, --reasoning <level>    Reasoning effort: low, medium, high, xhigh (default: xhigh)
  -m, --model <model>        Model name (default: gpt-5.3-codex)
  -s, --sandbox <mode>       Sandbox: read-only, workspace-write, danger-full-access
  -f, --file <glob>          Include files matching glob (can repeat)
  -d, --dir <path>           Working directory (default: cwd)
  --parent-session <id>      Parent session ID for linkage
  --map                      Include codebase map if available
  --dry-run                  Show prompt without executing
  --strip-ansi               Remove ANSI escape codes from output (for capture/output)
  --json                     Output JSON (jobs command only)
  --limit <n>                Limit jobs shown (jobs command only)
  --all                      Show all jobs (jobs command only)
  --claim <pattern>          Claim file ownership (can repeat, start command)
  --context-budget <tokens>  Limit context injection tokens (start command)
  --retry <n>                Auto-retry on failure (start command)
  -h, --help                 Show this help

Examples:
  # Start an agent
  codex-agent start "Review this code for security issues" -f "src/**/*.ts"

  # Start with file claims
  codex-agent start "Implement auth module" --map --claim "src/auth/**"

  # Start with context budget
  codex-agent start "Fix the bug" -f "src/**/*.ts" --context-budget 5000

  # Check on it
  codex-agent capture abc123

  # Full report
  codex-agent report abc123

  # Send additional context
  codex-agent send abc123 "Also check the auth module"

  # Live dashboard
  codex-agent dashboard

  # Context recovery after compaction
  codex-agent context

Bidirectional Communication:
  - Use 'send' to give agents additional instructions mid-task
  - Use 'capture' to see recent output programmatically
  - Use 'attach' to interact directly in tmux
  - Press Ctrl+C in tmux to interrupt, type to continue conversation
`;

interface Options {
  reasoning: ReasoningEffort;
  model: string;
  sandbox: SandboxMode;
  files: string[];
  dir: string;
  includeMap: boolean;
  parentSessionId: string | null;
  dryRun: boolean;
  stripAnsi: boolean;
  json: boolean;
  jobsLimit: number | null;
  jobsAll: boolean;
  claims: string[];
  contextBudget: number | null;
  retry: number;
}

function stripAnsiCodes(text: string): string {
  return text
    // Remove ANSI escape sequences (colors, cursor movements, etc)
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    // Remove other escape sequences (OSC, etc)
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // Remove carriage returns (used for spinner overwrites)
    .replace(/\r/g, '')
    // Remove other control characters except newline and tab
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function parseArgs(args: string[]): {
  command: string;
  positional: string[];
  options: Options;
} {
  const options: Options = {
    reasoning: config.defaultReasoningEffort,
    model: config.model,
    sandbox: config.defaultSandbox,
    files: [],
    dir: process.cwd(),
    includeMap: false,
    parentSessionId: null,
    dryRun: false,
    stripAnsi: false,
    json: false,
    jobsLimit: config.jobsListLimit,
    jobsAll: false,
    claims: [],
    contextBudget: null,
    retry: 0,
  };

  const positional: string[] = [];
  let command = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "-r" || arg === "--reasoning") {
      const level = args[++i] as ReasoningEffort;
      if (config.reasoningEfforts.includes(level)) {
        options.reasoning = level;
      } else {
        console.error(`Invalid reasoning level: ${level}`);
        console.error(`Valid options: ${config.reasoningEfforts.join(", ")}`);
        process.exit(1);
      }
    } else if (arg === "-m" || arg === "--model") {
      options.model = args[++i];
    } else if (arg === "-s" || arg === "--sandbox") {
      const mode = args[++i] as SandboxMode;
      if (config.sandboxModes.includes(mode)) {
        options.sandbox = mode;
      } else {
        console.error(`Invalid sandbox mode: ${mode}`);
        console.error(`Valid options: ${config.sandboxModes.join(", ")}`);
        process.exit(1);
      }
    } else if (arg === "-f" || arg === "--file") {
      options.files.push(args[++i]);
    } else if (arg === "-d" || arg === "--dir") {
      options.dir = args[++i];
    } else if (arg === "--parent-session") {
      options.parentSessionId = args[++i] ?? null;
    } else if (arg === "--map") {
      options.includeMap = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--strip-ansi") {
      options.stripAnsi = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--limit") {
      const raw = args[++i];
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 1) {
        console.error(`Invalid limit: ${raw}`);
        process.exit(1);
      }
      options.jobsLimit = Math.floor(parsed);
    } else if (arg === "--all") {
      options.jobsAll = true;
    } else if (arg === "--claim") {
      options.claims.push(args[++i]);
    } else if (arg === "--context-budget") {
      const raw = args[++i];
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 1) {
        console.error(`Invalid context budget: ${raw}`);
        process.exit(1);
      }
      options.contextBudget = Math.floor(parsed);
    } else if (arg === "--retry") {
      const raw = args[++i];
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        console.error(`Invalid retry count: ${raw}`);
        process.exit(1);
      }
      options.retry = Math.floor(parsed);
    } else if (!arg.startsWith("-")) {
      if (!command) {
        command = arg;
      } else {
        positional.push(arg);
      }
    }
  }

  return { command, positional, options };
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function formatJobStatus(job: Job): string {
  const elapsed = job.startedAt
    ? formatDuration(
        (job.completedAt ? new Date(job.completedAt).getTime() : Date.now()) -
          new Date(job.startedAt).getTime()
      )
    : "-";

  const status = job.status.toUpperCase().padEnd(10);
  const promptPreview = job.prompt.slice(0, 50) + (job.prompt.length > 50 ? "..." : "");

  return `${job.id}  ${status}  ${elapsed.padEnd(8)}  ${job.reasoningEffort.padEnd(6)}  ${promptPreview}`;
}

function refreshJobsForDisplay(jobs: Job[]): Job[] {
  return jobs.map((job) => {
    if (job.status !== "running") return job;
    const refreshed = refreshJobStatus(job.id);
    return refreshed ?? job;
  });
}

function sortJobsRunningFirst(jobs: Job[]): Job[] {
  const statusRank: Record<Job["status"], number> = {
    running: 0,
    pending: 1,
    failed: 2,
    completed: 3,
  };

  return [...jobs].sort((a, b) => {
    const rankDiff = statusRank[a.status] - statusRank[b.status];
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function applyJobsLimit<T>(jobs: T[], limit: number | null): T[] {
  if (!limit || limit <= 0) return jobs;
  return jobs.slice(0, limit);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const { command, positional, options } = parseArgs(args);

  try {
    switch (command) {
      case "health": {
        // Check tmux
        if (!isTmuxAvailable()) {
          console.error("tmux not found");
          console.error("Install with: brew install tmux");
          process.exit(1);
        }
        console.log("tmux: OK");

        // Check codex
        const { execSync } = await import("child_process");
        try {
          const version = execSync("codex --version", { encoding: "utf-8" }).trim();
          console.log(`codex: ${version}`);
        } catch {
          console.error("codex CLI not found");
          console.error("Install with: npm install -g @openai/codex");
          process.exit(1);
        }

        // Check running agents heartbeat
        const runningJobs = listJobs().filter((j) => j.status === "running");
        if (runningJobs.length > 0) {
          console.log(`\nRunning agents: ${runningJobs.length}`);
          for (const job of runningJobs) {
            if (job.tmuxSession) {
              const hb = heartbeat(job.tmuxSession);
              const status = hb.alive ? "alive" : "dead";
              console.log(`  ${job.id}: ${status} (pid: ${hb.pid ?? "?"})`);
            }
          }
        }

        console.log("\nStatus: Ready");
        break;
      }

      case "start": {
        if (positional.length === 0) {
          console.error("Error: No prompt provided");
          process.exit(1);
        }

        // Check tmux first
        if (!isTmuxAvailable()) {
          console.error("Error: tmux is required but not installed");
          console.error("Install with: brew install tmux");
          process.exit(1);
        }

        let prompt = positional.join(" ");

        // Load file context if specified
        if (options.files.length > 0) {
          const files = await loadFiles(options.files, options.dir, options.contextBudget ?? undefined);
          prompt = formatPromptWithFiles(prompt, files);
          console.error(`Included ${files.length} files`);
        }

        // Include codebase map if requested
        if (options.includeMap) {
          const map = await loadCodebaseMap(options.dir);
          if (map) {
            prompt = `## Codebase Map\n\n${map}\n\n---\n\n${prompt}`;
            console.error("Included codebase map");
          } else {
            console.error("No codebase map found");
          }
        }

        if (options.dryRun) {
          const tokens = estimateTokens(prompt);
          console.log(`Would send ~${tokens.toLocaleString()} tokens`);
          console.log(`Model: ${options.model}`);
          console.log(`Reasoning: ${options.reasoning}`);
          console.log(`Sandbox: ${options.sandbox}`);
          if (options.claims.length > 0) {
            console.log(`Claims: ${options.claims.join(", ")}`);
          }
          console.log("\n--- Prompt Preview ---\n");
          console.log(prompt.slice(0, 3000));
          if (prompt.length > 3000) {
            console.log(`\n... (${prompt.length - 3000} more characters)`);
          }
          process.exit(0);
        }

        const startWithRetry = async (attempt: number = 0): Promise<Job> => {
          const job = startJob({
            prompt,
            model: options.model,
            reasoningEffort: options.reasoning,
            sandbox: options.sandbox,
            parentSessionId: options.parentSessionId ?? undefined,
            cwd: options.dir,
            claims: options.claims.length > 0 ? options.claims : undefined,
          });

          if (job.status === "failed" && attempt < options.retry) {
            console.error(`Attempt ${attempt + 1} failed: ${job.error}. Retrying...`);
            const { spawnSync } = await import("child_process");
            spawnSync("sleep", ["2"]);
            return startWithRetry(attempt + 1);
          }

          return job;
        };

        const job = await startWithRetry();

        console.log(`Job started: ${job.id}`);
        console.log(`Model: ${job.model} (${job.reasoningEffort})`);
        console.log(`Working dir: ${job.cwd}`);
        console.log(`tmux session: ${job.tmuxSession}`);
        if (options.claims.length > 0) {
          console.log(`Claims: ${options.claims.join(", ")}`);
        }
        console.log("");
        console.log("Commands:");
        console.log(`  Capture output:  codex-agent capture ${job.id}`);
        console.log(`  Send message:    codex-agent send ${job.id} "message"`);
        console.log(`  Full report:     codex-agent report ${job.id}`);
        console.log(`  Attach session:  tmux attach -t ${job.tmuxSession}`);
        break;
      }

      case "status": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        const job = refreshJobStatus(positional[0]);
        if (!job) {
          console.error(`Job ${positional[0]} not found`);
          process.exit(1);
        }

        console.log(`Job: ${job.id}`);
        console.log(`Status: ${job.status}`);
        console.log(`Model: ${job.model} (${job.reasoningEffort})`);
        console.log(`Sandbox: ${job.sandbox}`);
        console.log(`Created: ${job.createdAt}`);
        if (job.startedAt) {
          console.log(`Started: ${job.startedAt}`);
        }
        if (job.completedAt) {
          console.log(`Completed: ${job.completedAt}`);
        }
        if (job.tmuxSession) {
          console.log(`tmux session: ${job.tmuxSession}`);
        }
        if (job.error) {
          console.log(`Error: ${job.error}`);
        }
        break;
      }

      case "send": {
        if (positional.length < 2) {
          console.error("Error: Usage: codex-agent send <jobId> \"message\"");
          process.exit(1);
        }

        const jobId = positional[0];
        const message = positional.slice(1).join(" ");

        if (sendToJob(jobId, message)) {
          console.log(`Sent to ${jobId}: ${message}`);
        } else {
          console.error(`Could not send to job ${jobId}`);
          console.error("Job may not be running or tmux session not found");
          process.exit(1);
        }
        break;
      }

      case "capture": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        const lines = positional[1] ? parseInt(positional[1], 10) : 50;
        let output = getJobOutput(positional[0], lines);

        if (output) {
          if (options.stripAnsi) {
            output = stripAnsiCodes(output);
          }
          console.log(output);
        } else {
          console.error(`Could not capture output for job ${positional[0]}`);
          process.exit(1);
        }
        break;
      }

      case "output": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        let output = getJobFullOutput(positional[0]);
        if (output) {
          if (options.stripAnsi) {
            output = stripAnsiCodes(output);
          }
          console.log(output);
        } else {
          console.error(`Could not get output for job ${positional[0]}`);
          process.exit(1);
        }
        break;
      }

      case "attach": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        const attachCmd = getAttachCommand(positional[0]);
        if (attachCmd) {
          console.log(attachCmd);
        } else {
          console.error(`Job ${positional[0]} not found or no tmux session`);
          process.exit(1);
        }
        break;
      }

      case "watch": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        const job = loadJob(positional[0]);
        if (!job || !job.tmuxSession) {
          console.error(`Job ${positional[0]} not found or no tmux session`);
          process.exit(1);
        }

        console.error(`Watching ${job.tmuxSession}... (Ctrl+C to stop)`);
        console.error("For interactive mode, use: tmux attach -t " + job.tmuxSession);
        console.error("");

        // Simple polling-based watch
        let lastOutput = "";
        const pollInterval = setInterval(() => {
          const output = getJobOutput(positional[0], 100);
          if (output && output !== lastOutput) {
            // Print only new content
            if (lastOutput) {
              const newPart = output.replace(lastOutput, "");
              if (newPart.trim()) {
                process.stdout.write(newPart);
              }
            } else {
              console.log(output);
            }
            lastOutput = output;
          }

          // Check if job is still running
          const refreshed = refreshJobStatus(positional[0]);
          if (refreshed && refreshed.status !== "running") {
            console.error(`\nJob ${refreshed.status}`);
            clearInterval(pollInterval);
            process.exit(0);
          }
        }, 1000);

        // Handle Ctrl+C
        process.on("SIGINT", () => {
          clearInterval(pollInterval);
          console.error("\nStopped watching");
          process.exit(0);
        });
        break;
      }

      case "jobs": {
        if (options.json) {
          const payload = getJobsJson();
          const limit = options.jobsAll ? null : options.jobsLimit;
          const statusRank: Record<Job["status"], number> = {
            running: 0,
            pending: 1,
            failed: 2,
            completed: 3,
          };
          payload.jobs.sort((a, b) => {
            const rankDiff = statusRank[a.status] - statusRank[b.status];
            if (rankDiff !== 0) return rankDiff;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          });
          payload.jobs = applyJobsLimit(payload.jobs, limit);
          console.log(JSON.stringify(payload, null, 2));
          break;
        }

        const limit = options.jobsAll ? null : options.jobsLimit;
        const allJobs = refreshJobsForDisplay(listJobs());
        const jobs = applyJobsLimit(sortJobsRunningFirst(allJobs), limit);
        if (jobs.length === 0) {
          console.log("No jobs");
        } else {
          console.log("ID        STATUS      ELAPSED   EFFORT  PROMPT");
          console.log("-".repeat(80));
          for (const job of jobs) {
            console.log(formatJobStatus(job));
          }
        }
        break;
      }

      case "sessions": {
        const sessions = listSessions();
        if (sessions.length === 0) {
          console.log("No active codex-agent sessions");
        } else {
          console.log("SESSION NAME                    ATTACHED  CREATED");
          console.log("-".repeat(60));
          for (const session of sessions) {
            const attached = session.attached ? "yes" : "no";
            console.log(
              `${session.name.padEnd(30)}  ${attached.padEnd(8)}  ${session.created}`
            );
          }
        }
        break;
      }

      case "kill": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        if (killJob(positional[0])) {
          console.log(`Killed job: ${positional[0]}`);
        } else {
          console.error(`Could not kill job: ${positional[0]}`);
          process.exit(1);
        }
        break;
      }

      case "clean": {
        const cleaned = cleanupOldJobs(7);
        console.log(`Cleaned ${cleaned} old jobs`);

        // Also clean stale claims
        const activeIds = new Set(listJobs().map((j) => j.id));
        const staleClaims = cleanStaleClaims(activeIds);
        if (staleClaims > 0) {
          console.log(`Cleaned ${staleClaims} stale claims`);
        }
        break;
      }

      case "delete": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        if (deleteJob(positional[0])) {
          console.log(`Deleted job: ${positional[0]}`);
        } else {
          console.error(`Could not delete job: ${positional[0]}`);
          process.exit(1);
        }
        break;
      }

      // --- New commands ---

      case "report": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        const jobId = positional[0];
        const job = refreshJobStatus(jobId);
        if (!job) {
          console.error(`Job ${jobId} not found`);
          process.exit(1);
        }

        console.log(`=== Report: ${job.id} ===`);
        console.log(`Status: ${job.status}`);
        console.log(`Model: ${job.model} (${job.reasoningEffort})`);
        console.log(`Sandbox: ${job.sandbox}`);

        // Elapsed time
        if (job.startedAt) {
          const start = new Date(job.startedAt).getTime();
          const end = job.completedAt ? new Date(job.completedAt).getTime() : Date.now();
          console.log(`Duration: ${formatDuration(end - start)}`);
        }
        console.log(`Prompt: ${job.prompt.slice(0, 100)}${job.prompt.length > 100 ? "..." : ""}`);

        // Load session data for report
        const logFile = join(config.jobsDir, `${jobId}.log`);
        let logContent: string | null = null;
        try {
          logContent = readFileSync(logFile, "utf-8");
        } catch { /* no log file */ }

        let sessionFilePath: string | null = null;
        if (logContent) {
          const sessionId = extractSessionId(logContent);
          if (sessionId) {
            sessionFilePath = findSessionFile(sessionId);
          }
        }

        const report = generateSessionReport(sessionFilePath, logContent);

        // Token usage
        if (report.tokens) {
          console.log(`\nToken Usage:`);
          console.log(`  Input:  ${report.tokens.input.toLocaleString()}`);
          console.log(`  Output: ${report.tokens.output.toLocaleString()}`);
          console.log(`  Context: ${report.tokens.context_used_pct}% of ${report.tokens.context_window.toLocaleString()}`);
        }

        // Diff stats
        const ds = report.diff_stats;
        const totalFiles = ds.files_added.length + ds.files_updated.length + ds.files_deleted.length;
        if (totalFiles > 0) {
          console.log(`\nFile Changes (${totalFiles} files):`);
          if (ds.files_added.length > 0) {
            console.log(`  Added (${ds.files_added.length}):`);
            for (const f of ds.files_added) console.log(`    + ${f}`);
          }
          if (ds.files_updated.length > 0) {
            console.log(`  Updated (${ds.files_updated.length}):`);
            for (const f of ds.files_updated) console.log(`    ~ ${f}`);
          }
          if (ds.files_deleted.length > 0) {
            console.log(`  Deleted (${ds.files_deleted.length}):`);
            for (const f of ds.files_deleted) console.log(`    - ${f}`);
          }
        }

        // Warnings and errors
        if (report.errors.length > 0) {
          console.log(`\nErrors Detected:`);
          for (const e of report.errors) console.log(`  ! ${e}`);
        }
        if (report.warnings.length > 0) {
          console.log(`\nWarnings:`);
          for (const w of report.warnings) console.log(`  ? ${w}`);
        }

        // Summary
        if (report.summary) {
          console.log(`\nSummary:`);
          console.log(`  ${report.summary.slice(0, 500)}`);
        }

        if (job.error) {
          console.log(`\nError: ${job.error}`);
        }

        break;
      }

      case "log": {
        const log = readAgentLog(options.dir);
        if (log) {
          console.log(log);
        } else {
          console.log("No agents.log found in " + options.dir);
        }
        break;
      }

      case "context": {
        const jobs = listJobs();
        // Refresh running jobs first
        for (const job of jobs) {
          if (job.status === "running") refreshJobStatus(job.id);
        }
        const refreshed = listJobs();
        const summary = generateContextSummary(options.dir, refreshed);
        console.log(summary);
        break;
      }

      case "claims": {
        const claims = listClaims();
        if (claims.length === 0) {
          console.log("No active file claims");
        } else {
          console.log("JOB ID      PATTERN                          CLAIMED AT");
          console.log("-".repeat(70));
          for (const claim of claims) {
            console.log(
              `${claim.jobId.padEnd(10)}  ${claim.pattern.padEnd(30)}  ${claim.claimedAt}`
            );
          }
        }
        break;
      }

      case "dashboard": {
        runDashboard();
        break;
      }

      default:
        // Treat as prompt for start command
        if (command) {
          // Check tmux first
          if (!isTmuxAvailable()) {
            console.error("Error: tmux is required but not installed");
            console.error("Install with: brew install tmux");
            process.exit(1);
          }

          const prompt = [command, ...positional].join(" ");

          if (options.dryRun) {
            const tokens = estimateTokens(prompt);
            console.log(`Would send ~${tokens.toLocaleString()} tokens`);
            process.exit(0);
          }

          const job = startJob({
            prompt,
            model: options.model,
            reasoningEffort: options.reasoning,
            sandbox: options.sandbox,
            parentSessionId: options.parentSessionId ?? undefined,
            cwd: options.dir,
            claims: options.claims.length > 0 ? options.claims : undefined,
          });

          console.log(`Job started: ${job.id}`);
          console.log(`tmux session: ${job.tmuxSession}`);
          console.log(`Attach: tmux attach -t ${job.tmuxSession}`);
        } else {
          console.log(HELP);
        }
    }
  } catch (err) {
    console.error("Error:", (err as Error).message);
    process.exit(1);
  }
}

main();
