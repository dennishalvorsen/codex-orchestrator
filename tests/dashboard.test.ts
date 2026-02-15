import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const TEST_HOME = process.cwd();
process.env.HOME = TEST_HOME;

const { config } = await import("../src/config.ts");
const jobs = await import("../src/jobs.ts");
const claims = await import("../src/claims.ts");
const { runDashboard } = await import("../src/dashboard.ts");

const jobsDir = join(TEST_HOME, ".codex-agent", "jobs");
config.jobsDir = jobsDir;

function resetState(): void {
  rmSync(join(TEST_HOME, ".codex-agent"), { recursive: true, force: true });
  mkdirSync(jobsDir, { recursive: true });
}

async function renderDashboardOnce(intervalMs: number = 20): Promise<string> {
  const output: string[] = [];
  const previousSigintListeners = process.listeners("SIGINT");
  const originalExit = process.exit;
  const originalWrite = process.stdout.write;
  const originalLog = console.log;

  (process.stdout as any).write = (chunk: unknown) => {
    output.push(String(chunk));
    return true;
  };
  (console as any).log = (...values: unknown[]) => {
    output.push(values.map((v) => String(v)).join(" "));
  };
  (process as any).exit = ((code?: number) => {
    void code;
    return undefined as never;
  }) as typeof process.exit;

  try {
    runDashboard(intervalMs);
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        process.emit("SIGINT");
        resolve();
      }, 80);
    });
  } finally {
    process.removeAllListeners("SIGINT");
    for (const listener of previousSigintListeners) {
      process.on("SIGINT", listener);
    }
    process.exit = originalExit;
    (process.stdout as any).write = originalWrite;
    (console as any).log = originalLog;
  }

  return output.join("\n");
}

describe("runDashboard", () => {
  it("renders empty state and stops on SIGINT", async () => {
    resetState();
    const rendered = await renderDashboardOnce();
    expect(rendered).toContain("Codex Agent Dashboard");
    expect(rendered).toContain("No agents spawned yet");
    expect(rendered).toContain("Dashboard stopped.");
  });

  it("renders jobs, live output, and claims sections", async () => {
    resetState();
    const runningId = "a1b2c3d4";
    const completedId = "b1b2c3d4";
    const failedId = "c1b2c3d4";
    jobs.saveJob({
      id: runningId,
      status: "running",
      prompt: "Running dashboard task",
      model: "gpt-5.3-codex",
      reasoningEffort: "xhigh",
      sandbox: "workspace-write",
      cwd: process.cwd(),
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    jobs.saveJob({
      id: completedId,
      status: "completed",
      prompt: "Finished dashboard task",
      model: "gpt-5.3-codex",
      reasoningEffort: "xhigh",
      sandbox: "workspace-write",
      cwd: process.cwd(),
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
    });
    jobs.saveJob({
      id: failedId,
      status: "failed",
      prompt: "Failed dashboard task",
      model: "gpt-5.3-codex",
      reasoningEffort: "xhigh",
      sandbox: "workspace-write",
      cwd: process.cwd(),
      createdAt: "2026-01-01T00:00:00.000Z",
      error: "failure",
    });

    writeFileSync(join(jobsDir, `${runningId}.log`), "line1\nline2\nlatest line");
    claims.addClaim(runningId, "src/dashboard/**");

    const rendered = await renderDashboardOnce();
    expect(rendered).toContain("running,");
    expect(rendered).toContain("Live Output");
    expect(rendered).toContain("latest line");
    expect(rendered).toContain("File Claims");
    expect(rendered).toContain("src/dashboard/**");
  });
});
