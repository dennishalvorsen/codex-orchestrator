import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

const TEST_HOME = process.cwd();
process.env.HOME = TEST_HOME;

const cli = await import("../src/cli.ts");
const jobs = await import("../src/jobs.ts");
const { config } = await import("../src/config.ts");
const CLI_PATH = join(process.cwd(), "src", "cli.ts");
config.jobsDir = join(TEST_HOME, ".codex-agent", "jobs");

class CliExit extends Error {
  code: number;

  constructor(code: number) {
    super(`CLI_EXIT_${code}`);
    this.code = code;
  }
}

function resetCliState(): void {
  rmSync(join(TEST_HOME, ".codex-agent"), { recursive: true, force: true });
  mkdirSync(config.jobsDir, { recursive: true });
}

async function runCliInProcess(args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const originalArgv = process.argv.slice();
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  const stdout: string[] = [];
  const stderr: string[] = [];
  let code = 0;
  let sawExit = false;
  let unexpectedRejection: unknown = null;

  const onUnhandledRejection = (reason: unknown) => {
    if (reason instanceof CliExit) return;
    unexpectedRejection = reason;
  };

  process.on("unhandledRejection", onUnhandledRejection);
  (console as any).log = (...values: unknown[]) => {
    stdout.push(values.map((v) => String(v)).join(" "));
  };
  (console as any).error = (...values: unknown[]) => {
    stderr.push(values.map((v) => String(v)).join(" "));
  };
  (process as any).exit = ((exitCode?: number) => {
    sawExit = true;
    code = exitCode ?? 0;
    throw new CliExit(code);
  }) as typeof process.exit;
  process.argv = ["bun", CLI_PATH, ...args];

  try {
    try {
      await import(`../src/cli.ts?run=${Date.now()}-${Math.random()}`);
    } catch (err) {
      if (!(err instanceof CliExit)) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally {
    process.argv = originalArgv;
    process.exit = originalExit;
    (console as any).log = originalLog;
    (console as any).error = originalError;
    process.removeListener("unhandledRejection", onUnhandledRejection);
  }

  if (unexpectedRejection) {
    throw unexpectedRejection;
  }

  return {
    code: sawExit ? code : 0,
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
  };
}

function runCli(args: string[], envOverrides: Record<string, string> = {}): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: TEST_HOME,
      ...envOverrides,
    },
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function createFakeBinDir(): string {
  const binDir = mkdtempSync(join(tmpdir(), "codex-orchestrator-cli-bin-"));
  const tmuxPath = join(binDir, "tmux");
  const codexPath = join(binDir, "codex");

  writeFileSync(
    tmuxPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "-V" ]; then',
      '  echo "tmux 3.4"',
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n")
  );
  writeFileSync(
    codexPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then',
      '  echo "codex 1.0.0"',
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n")
  );
  chmodSync(tmuxPath, 0o755);
  chmodSync(codexPath, 0o755);
  return binDir;
}

describe("stripAnsiCodes", () => {
  it("removes ANSI color codes", () => {
    const value = "\u001b[32mOK\u001b[0m";
    expect(cli.stripAnsiCodes(value)).toBe("OK");
  });
});

describe("formatDuration", () => {
  it("formats seconds", () => {
    expect(cli.formatDuration(5_000)).toBe("5s");
  });

  it("formats minutes and seconds", () => {
    expect(cli.formatDuration(125_000)).toBe("2m 5s");
  });

  it("formats hours and minutes", () => {
    expect(cli.formatDuration(3_720_000)).toBe("1h 2m");
  });
});

describe("parseArgs behavior via CLI execution", () => {
  it("handles supported flags and values", () => {
    const binDir = createFakeBinDir();
    const workDir = mkdtempSync(join(tmpdir(), "codex-orchestrator-cli-work-"));
    try {
      mkdirSync(join(workDir, "docs"), { recursive: true });
      writeFileSync(join(workDir, "sample.txt"), "hello");
      writeFileSync(join(workDir, "docs", "CODEBASE_MAP.md"), "# map");

      const result = runCli(
        [
          "start",
          "run",
          "tests",
          "-r",
          "high",
          "-m",
          "gpt-custom",
          "-s",
          "workspace-write",
          "-f",
          "sample.txt",
          "-d",
          workDir,
          "--parent-session",
          "session-123",
          "--map",
          "--dry-run",
          "--claim",
          "src/**",
          "--context-budget",
          "5000",
          "--retry",
          "2",
        ],
        { PATH: `${binDir}:${process.env.PATH || ""}` }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Model: gpt-custom");
      expect(result.stdout).toContain("Reasoning: high");
      expect(result.stdout).toContain("Sandbox: workspace-write");
      expect(result.stdout).toContain("Claims: src/**");
      expect(result.stderr).toContain("Included 1 files");
      expect(result.stderr).toContain("Included codebase map");
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("errors on unknown flags", () => {
    const result = runCli(["jobs", "--not-a-real-flag"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown option: --not-a-real-flag");
  });

  it("errors on missing flag values", () => {
    const result = runCli(["jobs", "--model"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing value for --model");
  });

  it("capture rejects non-numeric line input", () => {
    const result = runCli(["capture", "abcdef12", "abc"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid line count: abc");
  });
});

describe("CLI command coverage", () => {
  it("executes major command paths in-process", async () => {
    resetCliState();
    const jobId = "abc12345";
    const runningJobId = "faceb00c";
    const baseJob = {
      id: jobId,
      status: "completed" as const,
      prompt: "Inspect project health",
      model: "gpt-5.3-codex",
      reasoningEffort: "xhigh" as const,
      sandbox: "workspace-write" as const,
      cwd: process.cwd(),
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:10.000Z",
      completedAt: "2026-01-01T00:01:10.000Z",
      tmuxSession: "codex-agent-abc12345",
    };
    const runningJob = {
      ...baseJob,
      id: runningJobId,
      status: "running" as const,
      startedAt: "2026-01-01T00:00:10.000Z",
      completedAt: undefined,
      tmuxSession: undefined,
    };

    jobs.saveJob(baseJob);
    jobs.saveJob(runningJob);
    writeFileSync(join(config.jobsDir, `${jobId}.log`), "line1\nline2\nsession id: deadbeef");
    writeFileSync(join(config.jobsDir, `${jobId}.prompt`), "Inspect project health");

    const statusResult = await runCliInProcess(["status", jobId]);
    expect(statusResult.code).toBe(0);
    expect(statusResult.stdout).toContain("Status: completed");

    const captureResult = await runCliInProcess(["capture", jobId, "1"]);
    expect(captureResult.code).toBe(0);
    expect(captureResult.stdout).toContain("session id: deadbeef");

    const outputResult = await runCliInProcess(["output", jobId]);
    expect(outputResult.code).toBe(0);
    expect(outputResult.stdout).toContain("line1");

    const attachResult = await runCliInProcess(["attach", jobId]);
    expect(attachResult.code).toBe(0);
    expect(attachResult.stdout).toContain("tmux attach -t");

    const jobsResult = await runCliInProcess(["jobs"]);
    expect(jobsResult.code).toBe(0);
    expect(jobsResult.stdout).toContain("ID        STATUS");

    const jobsJsonResult = await runCliInProcess(["jobs", "--json"]);
    expect(jobsJsonResult.code).toBe(0);
    expect(jobsJsonResult.stdout).toContain("\"jobs\"");

    const reportResult = await runCliInProcess(["report", jobId]);
    expect(reportResult.code).toBe(0);
    expect(reportResult.stdout).toContain("=== Report:");

    const sessionsResult = await runCliInProcess(["sessions"]);
    expect(sessionsResult.code).toBe(0);

    const claimsResult = await runCliInProcess(["claims"]);
    expect(claimsResult.code).toBe(0);

    const contextResult = await runCliInProcess(["context"]);
    expect(contextResult.code).toBe(0);
    expect(contextResult.stdout).toContain("Context Recovery Summary");

    const logResult = await runCliInProcess(["log"]);
    expect(logResult.code).toBe(0);

    const killResult = await runCliInProcess(["kill", runningJobId]);
    expect(killResult.code).toBe(0);
    expect(killResult.stdout).toContain("Killed job");

    const cleanResult = await runCliInProcess(["clean"]);
    expect(cleanResult.code).toBe(0);
    expect(cleanResult.stdout).toContain("Cleaned");

    const deleteResult = await runCliInProcess(["delete", jobId]);
    expect(deleteResult.code).toBe(0);
    expect(deleteResult.stdout).toContain("Deleted job");
  });
});
