import { describe, expect, it } from "bun:test";
import {
  detectIssues,
  extractSessionId,
  findSessionFile,
  generateSessionReport,
  parseJsonlSession,
  parseSessionFile,
  stripAnsiCodes,
} from "../src/session-parser.ts";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("extractSessionId", () => {
  it("extracts from 'session id:' format", () => {
    expect(extractSessionId("session id: abcdef12")).toBe("abcdef12");
  });

  it("extracts from 'session_id=' format", () => {
    expect(extractSessionId("session_id=abcdef12")).toBe("abcdef12");
  });

  it("extracts from 'session_id:' format", () => {
    expect(extractSessionId("session_id: abcdef12")).toBe("abcdef12");
  });

  it("returns null when no session ID is present", () => {
    expect(extractSessionId("no session metadata here")).toBeNull();
  });
});

describe("parseJsonlSession", () => {
  it("parses tokens, summary, and modified files", () => {
    const jsonl = [
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 100, output_tokens: 40 },
            model_context_window: 2000,
          },
        },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "Finished applying changes.",
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call",
          name: "apply_patch",
          arguments: "*** Begin Patch\n*** Update File: src/foo.ts\n*** End Patch",
        },
      }),
    ].join("\n");

    const parsed = parseJsonlSession(jsonl);
    expect(parsed.tokens).toEqual({
      input: 100,
      output: 40,
      context_window: 2000,
      context_used_pct: 5,
    });
    expect(parsed.summary).toBe("Finished applying changes.");
    expect(parsed.files_modified).toEqual(["src/foo.ts"]);
  });
});

describe("stripAnsiCodes", () => {
  it("removes ANSI color sequences", () => {
    const value = "\u001b[31mError\u001b[0m";
    expect(stripAnsiCodes(value)).toBe("Error");
  });
});

describe("detectIssues", () => {
  it("returns empty lists for normal content", () => {
    const issues = detectIssues("All steps completed successfully.\nEverything looks healthy.\n");
    expect(issues.errors).toEqual([]);
    expect(issues.warnings).toEqual([]);
  });

  it("detects known error patterns", () => {
    const issues = detectIssues(
      "Error: request timed out\nprocess exited with code 2\nENOSPC while writing output"
    );
    expect(issues.errors.join(" | ")).toContain("Error line detected");
    expect(issues.errors.join(" | ")).toContain("Non-zero process exit");
    expect(issues.errors.join(" | ")).toContain("Disk full");
  });

  it("does not false-positive on discussion of errors", () => {
    const issues = detectIssues(
      "Discussion only: we should improve retry logic and edge-case handling."
    );
    expect(issues.errors).toEqual([]);
  });
});

describe("session file discovery and parsing", () => {
  it("finds a session file under CODEX_HOME and parses json sessions", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-orchestrator-session-home-"));
    const previousCodexHome = process.env.CODEX_HOME;
    try {
      const sessionDir = join(codexHome, "sessions", "2026", "01");
      mkdirSync(sessionDir, { recursive: true });
      const sessionId = "11112222-aaaa";
      const sessionFile = join(sessionDir, `${sessionId}.json`);
      writeFileSync(
        sessionFile,
        JSON.stringify({
          items: [
            {
              role: "assistant",
              content: [{ type: "text", text: "json summary text" }],
            },
          ],
        })
      );

      process.env.CODEX_HOME = codexHome;
      const found = findSessionFile(sessionId);
      expect(found).toBe(sessionFile);

      const parsed = parseSessionFile(sessionFile);
      expect(parsed?.summary).toBe("json summary text");
      expect(parsed?.files_modified).toEqual([]);
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      rmSync(codexHome, { recursive: true, force: true });
    }
  });

  it("generateSessionReport includes diff stats from apply_patch records", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-orchestrator-session-report-"));
    try {
      const sessionFile = join(dir, "session.jsonl");
      const patch = [
        "*** Begin Patch",
        "*** Add File: src/new.ts",
        "*** Update File: src/existing.ts",
        "*** Delete File: src/old.ts",
        "*** End Patch",
      ].join("\n");
      writeFileSync(
        sessionFile,
        [
          JSON.stringify({
            type: "response_item",
            payload: {
              type: "function_call",
              name: "apply_patch",
              arguments: patch,
            },
          }),
          JSON.stringify({
            type: "event_msg",
            payload: {
              type: "agent_message",
              message: "Completed report",
            },
          }),
        ].join("\n")
      );

      const report = generateSessionReport(
        sessionFile,
        "warning: deprecated API call\nError: timed out"
      );

      expect(report.summary).toBe("Completed report");
      expect(report.diff_stats.files_added).toEqual(["src/new.ts"]);
      expect(report.diff_stats.files_updated).toEqual(["src/existing.ts"]);
      expect(report.diff_stats.files_deleted).toEqual(["src/old.ts"]);
      expect(report.errors.join(" | ")).toContain("Error line detected");
      expect(report.warnings.join(" | ")).toContain("Deprecation warning");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
