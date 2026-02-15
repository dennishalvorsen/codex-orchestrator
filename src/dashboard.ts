// Live terminal dashboard for monitoring all agents

import { listJobs, refreshJobStatus, getJobOutput, type Job } from "./jobs.ts";
import { listClaims } from "./claims.ts";

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[0m`;
}

function green(text: string): string {
  return `\x1b[32m${text}\x1b[0m`;
}

function red(text: string): string {
  return `\x1b[31m${text}\x1b[0m`;
}

function yellow(text: string): string {
  return `\x1b[33m${text}\x1b[0m`;
}

function dim(text: string): string {
  return `\x1b[2m${text}\x1b[0m`;
}

function statusColor(status: Job["status"]): string {
  switch (status) {
    case "running": return green(status.toUpperCase());
    case "completed": return dim(status.toUpperCase());
    case "failed": return red(status.toUpperCase());
    case "cancelled": return red(status.toUpperCase());
    case "pending": return yellow(status.toUpperCase());
  }
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${m % 60}m`;
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

function renderDashboard(jobs: Job[]): string {
  const lines: string[] = [];
  const now = Date.now();

  lines.push(bold("=== Codex Agent Dashboard ==="));
  lines.push(dim(`Updated: ${new Date().toISOString().slice(11, 19)}  |  Press Ctrl+C to exit`));
  lines.push("");

  // Summary
  const running = jobs.filter((j) => j.status === "running");
  const completed = jobs.filter((j) => j.status === "completed");
  const failed = jobs.filter((j) => j.status === "failed");

  lines.push(
    `Agents: ${green(String(running.length))} running, ` +
    `${dim(String(completed.length))} completed, ` +
    `${red(String(failed.length))} failed`
  );
  lines.push("");

  // Agent table
  if (jobs.length === 0) {
    lines.push(dim("  No agents spawned yet."));
    return lines.join("\n");
  }

  lines.push(bold("  ID        STATUS      ELAPSED   PROMPT"));
  lines.push("  " + "-".repeat(70));

  for (const job of jobs) {
    const start = job.startedAt ?? job.createdAt;
    const end = job.completedAt ? Date.parse(job.completedAt) : now;
    const elapsed = formatElapsed(end - Date.parse(start));
    const prompt = job.prompt.slice(0, 40) + (job.prompt.length > 40 ? "..." : "");
    const status = statusColor(job.status).padEnd(20); // padEnd accounts for ANSI

    lines.push(`  ${job.id}  ${status}  ${elapsed.padEnd(8)}  ${prompt}`);
  }

  lines.push("");

  // Show last output line for running agents
  if (running.length > 0) {
    lines.push(bold("--- Live Output (last line per agent) ---"));
    for (const job of running) {
      const output = getJobOutput(job.id, 3);
      if (output) {
        const lastLine = output.trim().split("\n").pop() || "";
        const truncated = lastLine.slice(0, 70) + (lastLine.length > 70 ? "..." : "");
        lines.push(`  ${dim(job.id)}: ${truncated}`);
      }
    }
    lines.push("");
  }

  // Show active claims
  try {
    const claims = listClaims();
    if (claims.length > 0) {
      lines.push(bold("--- File Claims ---"));
      for (const claim of claims) {
        lines.push(`  ${dim(claim.jobId)}: ${claim.pattern}`);
      }
      lines.push("");
    }
  } catch { /* claims file might not exist */ }

  return lines.join("\n");
}

/**
 * Run the live dashboard, polling at the specified interval
 */
export function runDashboard(intervalMs: number = 2000): void {
  let running = true;

  const refresh = () => {
    if (!running) return;

    // Refresh status for running jobs
    const allJobs = listJobs();
    for (const job of allJobs) {
      if (job.status === "running") {
        refreshJobStatus(job.id);
      }
    }

    // Re-load after refresh
    const jobs = listJobs();

    // Sort: running first, then by creation time
    const statusRank: Record<Job["status"], number> = {
      running: 0,
      pending: 1,
      failed: 2,
      cancelled: 3,
      completed: 4,
    };
    jobs.sort((a, b) => {
      const rankDiff = statusRank[a.status] - statusRank[b.status];
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // Limit to 20 most recent
    const display = jobs.slice(0, 20);

    clearScreen();
    console.log(renderDashboard(display));
  };

  // Initial render
  refresh();

  const interval = setInterval(refresh, intervalMs);

  process.on("SIGINT", () => {
    running = false;
    clearInterval(interval);
    clearScreen();
    console.log("Dashboard stopped.");
    process.exit(0);
  });
}
