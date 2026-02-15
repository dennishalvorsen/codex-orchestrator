import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  appendToAgentLog,
  generateContextSummary,
  logJobComplete,
  logJobSpawn,
  readAgentLog,
} from "../src/agent-log.ts";
import type { Job } from "../src/jobs.ts";

function makeJob(id: string, cwd: string, overrides: Partial<Job> = {}): Job {
  return {
    id,
    status: "running",
    prompt: "Investigate flaky tests",
    model: "gpt-5.3-codex",
    reasoningEffort: "xhigh",
    sandbox: "workspace-write",
    cwd,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("agent log utilities", () => {
  it("reads null when the log does not exist", () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-orchestrator-agent-log-missing-"));
    try {
      expect(readAgentLog(cwd)).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("appends entries and auto-creates header", () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-orchestrator-agent-log-append-"));
    try {
      appendToAgentLog(cwd, "first line");
      appendToAgentLog(cwd, "second line");
      const content = readFileSync(join(cwd, "agents.log"), "utf-8");
      expect(content).toContain("# Agents Log");
      expect(content).toContain("first line");
      expect(content).toContain("second line");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("records spawn and completion entries", () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-orchestrator-agent-log-events-"));
    try {
      const researchJob = makeJob("aaaabbbb", cwd, {
        sandbox: "read-only",
        prompt: "Read architecture and summarize",
      });
      logJobSpawn(researchJob);
      logJobComplete(
        makeJob("aaaabbbb", cwd, {
          status: "completed",
          error: "none",
        }),
        "Finished summary generation."
      );

      const content = readFileSync(join(cwd, "agents.log"), "utf-8");
      expect(content).toContain("### Spawned: aaaabbbb");
      expect(content).toContain("Type: research");
      expect(content).toContain("### Complete: aaaabbbb");
      expect(content).toContain("Summary: Finished summary generation.");
      expect(content).toContain("Error: none");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("generates a context summary across running/completed/failed jobs", () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-orchestrator-agent-log-summary-"));
    try {
      appendToAgentLog(cwd, "recent event");
      const jobs: Job[] = [
        makeJob("run00001", cwd, {
          status: "running",
          startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          prompt: "Running task prompt",
        }),
        makeJob("done0001", cwd, {
          status: "completed",
          completedAt: new Date().toISOString(),
          prompt: "Completed task prompt",
        }),
        makeJob("fail0001", cwd, {
          status: "failed",
          error: "network issue",
        }),
      ];

      const summary = generateContextSummary(cwd, jobs);
      expect(summary).toContain("Context Recovery Summary");
      expect(summary).toContain("Running Agents (1)");
      expect(summary).toContain("Recently Completed (1)");
      expect(summary).toContain("Failed (1)");
      expect(summary).toContain("recent event");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
