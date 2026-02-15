import { describe, expect, it } from "bun:test";

describe("config defaults", () => {
  it("has expected default values", async () => {
    const fakeHome = `/tmp/codex-config-home-${Date.now()}`;
    const previousHome = process.env.HOME;
    process.env.HOME = fakeHome;

    try {
      const mod = await import(`../src/config.ts?defaults=${Date.now()}`);
      expect(mod.config.model).toBe("gpt-5.3-codex");
      expect(mod.config.defaultReasoningEffort).toBe("xhigh");
      expect(mod.config.defaultSandbox).toBe("workspace-write");
      expect(mod.config.defaultTimeout).toBe(60);
      expect(mod.config.jobsDir).toBe(`${fakeHome}/.codex-agent/jobs`);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  });

  it("statusRank contains all expected statuses", async () => {
    const mod = await import(`../src/config.ts?status-rank=${Date.now()}`);
    expect(mod.statusRank.running).toBe(0);
    expect(mod.statusRank.pending).toBe(1);
    expect(mod.statusRank.failed).toBe(2);
    expect(mod.statusRank.cancelled).toBe(3);
    expect(mod.statusRank.completed).toBe(4);
  });
});

describe("HOME validation", () => {
  it("throws when HOME is missing", async () => {
    const previousHome = process.env.HOME;
    delete process.env.HOME;

    try {
      let message = "";
      try {
        await import(`../src/config.ts?missing-home=${Date.now()}`);
      } catch (err) {
        message = String((err as Error).message || err);
      }
      expect(message).toContain("HOME environment variable is not set");
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  });
});
