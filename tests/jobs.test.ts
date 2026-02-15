import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const TEST_HOME = process.cwd();
process.env.HOME = TEST_HOME;

const jobs = await import("../src/jobs.ts");
const claims = await import("../src/claims.ts");
const { config } = await import("../src/config.ts");

const jobsDir = join(TEST_HOME, ".codex-agent", "jobs");
config.jobsDir = jobsDir;

type Job = import("../src/jobs.ts").Job;

function resetState(): void {
  rmSync(join(TEST_HOME, ".codex-agent"), { recursive: true, force: true });
  mkdirSync(jobsDir, { recursive: true });
}

function makeJob(id: string, overrides: Partial<Job> = {}): Job {
  return {
    id,
    status: "pending",
    prompt: "Test prompt",
    model: "gpt-5.3-codex",
    reasoningEffort: "xhigh",
    sandbox: "workspace-write",
    cwd: process.cwd(),
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function withTmuxScript<T>(scriptLines: string[], fn: () => T): T {
  const tmuxPath = join(process.cwd(), "bin", "tmux");
  writeFileSync(tmuxPath, scriptLines.join("\n") + "\n");
  chmodSync(tmuxPath, 0o755);
  try {
    return fn();
  } finally {
    try { unlinkSync(tmuxPath); } catch {}
  }
}

describe("assertValidJobId", () => {
  it("accepts valid 8-char hex IDs", () => {
    const validIds = ["abcdef12", "ABCDEF12", "1234abcd"];

    for (const id of validIds) {
      expect(() => jobs.assertValidJobId(id)).not.toThrow();
    }
  });

  it("rejects path traversal and path-like values", () => {
    const invalidIds = ["../abcd1234", "abcd1234/..", "ab/cd1234", "abcd1234.json"];

    for (const id of invalidIds) {
      expect(() => jobs.assertValidJobId(id)).toThrow();
    }
  });

  it("rejects IDs that are too short or too long", () => {
    const invalidIds = ["", "abc1234", "abcdef123"];

    for (const id of invalidIds) {
      expect(() => jobs.assertValidJobId(id)).toThrow();
    }
  });
});

describe("Job status type", () => {
  it("includes cancelled", () => {
    const status: Job["status"] = "cancelled";
    expect(status).toBe("cancelled");
  });
});

describe("generateJobId", () => {
  it("returns an 8-character hex string", () => {
    const id = jobs.generateJobId();
    expect(id).toMatch(/^[a-f0-9]{8}$/i);
  });
});

describe("save/load lifecycle", () => {
  it("round-trips saveJob and loadJob", () => {
    resetState();
    const job = makeJob("abcd1234", {
      status: "running",
      startedAt: "2026-01-01T00:01:00.000Z",
      tmuxSession: "codex-agent-abcd1234",
    });

    jobs.saveJob(job);
    expect(jobs.loadJob(job.id)).toEqual(job);
  });

  it("deleteJob with valid ID cleans up files", () => {
    resetState();
    const jobId = "deadbeef";
    const job = makeJob(jobId);
    jobs.saveJob(job);
    writeFileSync(join(jobsDir, `${jobId}.prompt`), "prompt");
    writeFileSync(join(jobsDir, `${jobId}.log`), "output");

    expect(jobs.deleteJob(jobId)).toBe(true);
    expect(existsSync(join(jobsDir, `${jobId}.json`))).toBe(false);
    expect(existsSync(join(jobsDir, `${jobId}.prompt`))).toBe(false);
    expect(existsSync(join(jobsDir, `${jobId}.log`))).toBe(false);
  });

  it("deleteJob with invalid ID throws", () => {
    resetState();
    expect(() => jobs.deleteJob("../oops")).toThrow();
  });
});

describe("kill and cleanup behavior", () => {
  it("killJob sets status to cancelled and removes claims", () => {
    resetState();
    const jobId = "c0ffee12";
    jobs.saveJob(makeJob(jobId, { status: "running" }));
    claims.addClaim(jobId, "src/**");
    expect(claims.listClaims().some((claim) => claim.jobId === jobId)).toBe(true);

    expect(jobs.killJob(jobId)).toBe(true);
    const updated = jobs.loadJob(jobId);
    expect(updated?.status).toBe("cancelled");
    expect(updated?.error).toBe("Cancelled by user");
    expect(claims.listClaims().some((claim) => claim.jobId === jobId)).toBe(false);
  });

  it("cleanupOldJobs includes cancelled jobs", () => {
    resetState();
    const nowIso = new Date().toISOString();
    jobs.saveJob(
      makeJob("1111aaaa", {
        status: "cancelled",
        createdAt: "2025-01-01T00:00:00.000Z",
        completedAt: "2025-01-02T00:00:00.000Z",
      })
    );
    jobs.saveJob(
      makeJob("2222bbbb", {
        status: "cancelled",
        createdAt: nowIso,
        completedAt: nowIso,
      })
    );
    jobs.saveJob(
      makeJob("3333cccc", {
        status: "running",
        createdAt: "2025-01-01T00:00:00.000Z",
      })
    );

    const cleaned = jobs.cleanupOldJobs(7);

    expect(cleaned).toBe(1);
    expect(jobs.loadJob("1111aaaa")).toBeNull();
    expect(jobs.loadJob("2222bbbb")?.status).toBe("cancelled");
    expect(jobs.loadJob("3333cccc")?.status).toBe("running");
  });
});

describe("elapsed calculation edge cases", () => {
  it("handles missing startedAt and invalid dates through getJobsJson", () => {
    resetState();
    jobs.saveJob(
      makeJob("4444dddd", {
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:01:30.000Z",
      })
    );
    jobs.saveJob(
      makeJob("5555eeee", {
        status: "completed",
        createdAt: "not-a-date",
        completedAt: "still-not-a-date",
      })
    );

    const payload = jobs.getJobsJson();
    const normal = payload.jobs.find((job) => job.id === "4444dddd");
    const invalid = payload.jobs.find((job) => job.id === "5555eeee");

    expect((normal?.elapsed_ms ?? 0) > 0).toBe(true);
    expect(invalid?.elapsed_ms ?? -1).toBe(0);
  });
});

describe("job runtime behavior", () => {
  it("startJob succeeds with tmux and registers claims", () => {
    resetState();
    withTmuxScript(
      [
        "#!/bin/sh",
        'cmd="$1"',
        'if [ "$cmd" = "capture-pane" ]; then echo "ready"; exit 0; fi',
        'if [ "$cmd" = "has-session" ]; then exit 0; fi',
        "exit 0",
      ],
      () => {
        const job = jobs.startJob({
          prompt: "Implement feature",
          claims: ["src/**"],
        });

        expect(job.status).toBe("running");
        expect(job.tmuxSession ?? "").toContain("codex-agent-");
        expect(claims.listClaims().some((c) => c.jobId === job.id)).toBe(true);
        expect(jobs.sendToJob(job.id, "continue")).toBe(true);
        expect(jobs.sendControlToJob(job.id, "C-c")).toBe(true);
      }
    );
  });

  it("startJob fails when model validation fails", () => {
    resetState();
    const job = jobs.startJob({
      prompt: "bad model test",
      model: "gpt-5.3-codex;rm -rf /",
    });
    expect(job.status).toBe("failed");
    expect(job.error ?? "").toContain("Invalid model");
  });

  it("getJobOutput and getJobFullOutput fall back to log files", () => {
    resetState();
    const jobId = "1a2b3c4d";
    jobs.saveJob(makeJob(jobId, { status: "completed" }));
    writeFileSync(join(jobsDir, `${jobId}.log`), "line1\nline2\nline3");

    expect(jobs.getJobOutput(jobId, 1)).toBe("line3");
    expect(jobs.getJobFullOutput(jobId)).toContain("line1");
  });

  it("refreshJobStatus completes when tmux session is gone", () => {
    resetState();
    const jobId = "2a2b3c4d";
    jobs.saveJob(
      makeJob(jobId, {
        status: "running",
        tmuxSession: "codex-agent-missing",
      })
    );
    writeFileSync(join(jobsDir, `${jobId}.log`), "session output");

    const refreshed = jobs.refreshJobStatus(jobId);
    expect(refreshed?.status).toBe("completed");
    expect(refreshed?.result).toContain("session output");
  });

  it("refreshJobStatus completes when completion marker is present", () => {
    resetState();
    const jobId = "3a2b3c4d";
    jobs.saveJob(
      makeJob(jobId, {
        status: "running",
        tmuxSession: "codex-agent-active",
      })
    );

    withTmuxScript(
      [
        "#!/bin/sh",
        'cmd="$1"',
        'if [ "$cmd" = "has-session" ]; then exit 0; fi',
        'if [ "$cmd" = "capture-pane" ]; then',
        '  if [ "$5" = "-S" ] && [ "$6" = "-" ]; then',
        '    echo "full history output"',
        "  else",
        '    echo "[codex-agent: Session complete. Press Enter to close.]"',
        "  fi",
        "  exit 0",
        "fi",
        "exit 0",
      ],
      () => {
        const refreshed = jobs.refreshJobStatus(jobId);
        expect(refreshed?.status).toBe("completed");
        expect(refreshed?.result).toContain("full history output");
      }
    );
  });

  it("refreshJobStatus marks failed when errors are detected", () => {
    resetState();
    const jobId = "4a2b3c4d";
    jobs.saveJob(
      makeJob(jobId, {
        status: "running",
        tmuxSession: "codex-agent-error",
      })
    );

    withTmuxScript(
      [
        "#!/bin/sh",
        'cmd="$1"',
        'if [ "$cmd" = "has-session" ]; then exit 0; fi',
        'if [ "$cmd" = "capture-pane" ]; then echo "Error: request failed"; exit 0; fi',
        "exit 0",
      ],
      () => {
        const refreshed = jobs.refreshJobStatus(jobId);
        expect(refreshed?.status).toBe("failed");
        expect(refreshed?.error ?? "").toContain("Detected:");
      }
    );
  });
});
