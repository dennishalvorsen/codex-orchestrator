import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const TEST_HOME = process.cwd();
process.env.HOME = TEST_HOME;

const tmux = await import("../src/tmux.ts");
const { config } = await import("../src/config.ts");

const jobsDir = join(TEST_HOME, ".codex-agent", "jobs");
config.jobsDir = jobsDir;

function setupJobsDir(): void {
  rmSync(jobsDir, { recursive: true, force: true });
  mkdirSync(jobsDir, { recursive: true });
}

function withWorkspaceFakeTmux<T>(fn: () => T): T {
  const tmuxPath = join(process.cwd(), "bin", "tmux");
  writeFileSync(
    tmuxPath,
    [
      "#!/bin/sh",
      'cmd="$1"',
      'if [ "$cmd" = "has-session" ]; then exit 0; fi',
      'if [ "$cmd" = "send-keys" ]; then exit 0; fi',
      'if [ "$cmd" = "kill-session" ]; then exit 0; fi',
      'if [ "$cmd" = "-V" ]; then echo "tmux 3.4"; exit 0; fi',
      "exit 0",
      "",
    ].join("\n")
  );
  chmodSync(tmuxPath, 0o755);

  try {
    return fn();
  } finally {
    try { unlinkSync(tmuxPath); } catch {}
  }
}

function withRichFakeTmux<T>(fn: () => T): T {
  const tmuxPath = join(process.cwd(), "bin", "tmux");
  writeFileSync(
    tmuxPath,
    [
      "#!/bin/sh",
      'cmd="$1"',
      'if [ "$cmd" = "-V" ]; then echo "tmux 3.4"; exit 0; fi',
      'if [ "$cmd" = "has-session" ]; then',
      '  if [ "$3" = "missing" ]; then exit 1; fi',
      "  exit 0",
      "fi",
      'if [ "$cmd" = "capture-pane" ]; then',
      '  if [ "$5" = "-S" ] && [ "$6" = "-" ]; then',
      '    printf "hist1\\nhist2"',
      "  else",
      '    printf "line1\\nline2\\nline3"',
      "  fi",
      "  exit 0",
      "fi",
      'if [ "$cmd" = "list-sessions" ]; then',
      '  printf "codex-agent-one|1|2|1700000000\\nother|0|1|1700000000\\n"',
      "  exit 0",
      "fi",
      'if [ "$cmd" = "list-panes" ]; then',
      '  echo "$PPID"',
      "  exit 0",
      "fi",
      'if [ "$cmd" = "new-session" ] || [ "$cmd" = "send-keys" ] || [ "$cmd" = "load-buffer" ] || [ "$cmd" = "paste-buffer" ] || [ "$cmd" = "kill-session" ]; then exit 0; fi',
      "exit 0",
      "",
    ].join("\n")
  );
  chmodSync(tmuxPath, 0o755);

  try {
    return fn();
  } finally {
    try { unlinkSync(tmuxPath); } catch {}
  }
}

describe("incrementalDiff", () => {
  it("returns current output when previous output is empty", () => {
    const curr = "line1\nline2";
    expect(tmux.incrementalDiff("", curr)).toBe(curr);
  });

  it("returns empty string for identical input", () => {
    const text = "same\ncontent";
    expect(tmux.incrementalDiff(text, text)).toBe("");
  });

  it("returns full current output when there is no overlap", () => {
    const prev = "a\nb\nc";
    const curr = "x\ny\nz";
    expect(tmux.incrementalDiff(prev, curr)).toBe(curr);
  });

  it("handles partial overlap", () => {
    const prev = "a\nb\nc";
    const curr = "b\nc\nd";
    expect(tmux.incrementalDiff(prev, curr)).toBe("d");
  });

  it("handles rolling overlap across shifted windows", () => {
    const prev = "line1\nline2\nline3\nline4";
    const curr = "line3\nline4\nline5\nline6";
    expect(tmux.incrementalDiff(prev, curr)).toBe("line5\nline6");
  });
});

describe("session naming and safety", () => {
  it("getSessionName returns the expected format", () => {
    expect(tmux.getSessionName("abcdef12")).toBe("codex-agent-abcdef12");
  });

  it("getSessionName rejects invalid IDs", () => {
    const invalidIds = ["", "../abcd", "xyz", "abc-123"];
    for (const id of invalidIds) {
      expect(() => tmux.getSessionName(id)).toThrow();
    }
  });

  it("createSession rejects model injection attempts", () => {
    setupJobsDir();
    const result = tmux.createSession({
      jobId: "abc123ef",
      prompt: "hello",
      model: "gpt-5.3-codex;rm -rf /",
      reasoningEffort: "high",
      sandbox: "workspace-write",
      cwd: process.cwd(),
    });

    expect(result.success).toBe(false);
    expect(result.error ?? "").toContain("Invalid model");
  });
});

describe("control key whitelist", () => {
  it("rejects keys that are not in the allowed set", () => {
    expect(tmux.sendControl("codex-agent-any", "Tab")).toBe(false);
  });

  it("allows whitelisted control keys when tmux session checks succeed", () => {
    const ok = withWorkspaceFakeTmux(() => tmux.sendControl("codex-agent-any", "C-c"));
    expect(ok).toBe(true);
  });
});

describe("tmux command wrappers", () => {
  it("covers session lifecycle and capture helpers", () => {
    setupJobsDir();
    withRichFakeTmux(() => {
      expect(tmux.isTmuxAvailable()).toBe(true);
      expect(tmux.sessionExists("codex-agent-any")).toBe(true);
      expect(tmux.sessionExists("missing")).toBe(false);

      const created = tmux.createSession({
        jobId: "1122aabb",
        prompt: "hello",
        model: "gpt-5.3-codex",
        reasoningEffort: "xhigh",
        sandbox: "workspace-write",
        cwd: process.cwd(),
      });
      expect(created.success).toBe(true);
      expect(created.sessionName).toBe("codex-agent-1122aabb");

      expect(tmux.sendMessage("codex-agent-any", "follow up")).toBe(true);
      expect(tmux.sendMessage("missing", "nope")).toBe(false);

      expect(tmux.capturePane("codex-agent-any")).toContain("line1");
      expect(tmux.capturePane("codex-agent-any", { lines: 1 })).toBe("line3");
      expect(tmux.capturePane("missing")).toBeNull();

      expect(tmux.captureFullHistory("codex-agent-any")).toContain("hist1");
      expect(tmux.captureFullHistory("missing")).toBeNull();

      expect(tmux.killSession("codex-agent-any")).toBe(true);
      expect(tmux.killSession("missing")).toBe(false);

      const sessions = tmux.listSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0]?.name).toBe("codex-agent-one");
      expect(sessions[0]?.attached).toBe(true);

      expect(tmux.isSessionActive("codex-agent-any")).toBe(true);
      expect(tmux.isSessionActive("missing")).toBe(false);

      const hb = tmux.heartbeat("codex-agent-any");
      expect(hb.pid === null).toBe(false);
      expect(typeof hb.alive === "boolean").toBe(true);

      const hbMissing = tmux.heartbeat("missing");
      expect(hbMissing.alive).toBe(false);
      expect(hbMissing.pid).toBeNull();
    });
  });
});
