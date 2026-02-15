// Persistent agent log management
// Maintains agents.log in the project root for context persistence across compactions

import { readFileSync, appendFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { Job } from "./jobs.ts";

const LOG_FILENAME = "agents.log";

function getLogPath(cwd: string): string {
  return join(cwd, LOG_FILENAME);
}

/**
 * Read the full agents.log content
 */
export function readAgentLog(cwd: string): string | null {
  const logPath = getLogPath(cwd);
  try {
    return readFileSync(logPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Append an entry to agents.log, creating it if necessary
 */
export function appendToAgentLog(cwd: string, entry: string): void {
  const logPath = getLogPath(cwd);
  if (!existsSync(logPath)) {
    writeFileSync(logPath, "# Agents Log\n\n", { mode: 0o600 });
  }
  appendFileSync(logPath, entry + "\n", { mode: 0o600 });
}

/**
 * Log a job spawn event
 */
export function logJobSpawn(job: Job): void {
  const timestamp = new Date().toISOString().slice(11, 16); // HH:MM
  const promptPreview = job.prompt.length > 100
    ? job.prompt.slice(0, 100) + "..."
    : job.prompt;

  const entry = [
    `### Spawned: ${job.id} - ${timestamp}`,
    `Type: ${job.sandbox === "read-only" ? "research" : "implementation"}`,
    `Prompt: ${promptPreview}`,
    `Reasoning: ${job.reasoningEffort}`,
    `Sandbox: ${job.sandbox}`,
    "",
  ].join("\n");

  appendToAgentLog(job.cwd, entry);
}

/**
 * Log a job completion event
 */
export function logJobComplete(job: Job, summary?: string): void {
  const timestamp = new Date().toISOString().slice(11, 16);
  const lines = [`### Complete: ${job.id} - ${timestamp}`];

  if (summary) {
    lines.push(`Summary: ${summary.slice(0, 300)}`);
  }
  if (job.error) {
    lines.push(`Error: ${job.error}`);
  }

  lines.push("");
  appendToAgentLog(job.cwd, lines.join("\n"));
}

/**
 * Generate a context summary of all active work.
 * Useful for recovery after context compaction.
 */
export function generateContextSummary(cwd: string, jobs: Job[]): string {
  const lines: string[] = [
    "## Context Recovery Summary",
    `Generated: ${new Date().toISOString()}`,
    `Working directory: ${cwd}`,
    "",
  ];

  const running = jobs.filter((j) => j.status === "running");
  const completed = jobs.filter((j) => j.status === "completed");
  const failed = jobs.filter((j) => j.status === "failed");

  if (running.length > 0) {
    lines.push(`### Running Agents (${running.length})`);
    for (const job of running) {
      const elapsed = job.startedAt
        ? Math.round((Date.now() - Date.parse(job.startedAt)) / 60000)
        : 0;
      lines.push(`- **${job.id}** (${elapsed}m) — ${job.prompt.slice(0, 80)}`);
    }
    lines.push("");
  }

  if (completed.length > 0) {
    lines.push(`### Recently Completed (${completed.length})`);
    for (const job of completed.slice(0, 10)) {
      lines.push(`- **${job.id}** — ${job.prompt.slice(0, 80)}`);
    }
    lines.push("");
  }

  if (failed.length > 0) {
    lines.push(`### Failed (${failed.length})`);
    for (const job of failed.slice(0, 5)) {
      lines.push(`- **${job.id}** — ${job.error || "unknown error"}`);
    }
    lines.push("");
  }

  // Include agents.log tail if it exists
  const log = readAgentLog(cwd);
  if (log) {
    const logLines = log.split("\n");
    const tail = logLines.slice(-30).join("\n");
    lines.push("### Recent agents.log entries");
    lines.push("```");
    lines.push(tail);
    lines.push("```");
  }

  return lines.join("\n");
}
