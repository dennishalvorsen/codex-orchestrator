import { describe, expect, it } from "bun:test";
import {
  estimateTokens,
  formatPromptWithFiles,
  loadCodebaseMap,
  loadFiles,
} from "../src/files.ts";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("estimateTokens", () => {
  it("returns a positive number", () => {
    const count = estimateTokens("Hello world");
    expect(count).toBeGreaterThan(0);
  });
});

describe("formatPromptWithFiles", () => {
  it("returns the original prompt when files are empty", () => {
    const prompt = "Do the thing";
    expect(formatPromptWithFiles(prompt, [])).toBe(prompt);
  });

  it("appends file context and code fences", () => {
    const prompt = "Review this";
    const formatted = formatPromptWithFiles(prompt, [
      { path: "src/example.ts", content: "export const x = 1;", size: 19, modifiedAt: "2026-01-01T00:00:00Z" },
      { path: "README.md", content: "# Project", size: 9, modifiedAt: "2026-01-01T00:00:00Z" },
    ]);

    expect(formatted).toContain("## File Context");
    expect(formatted).toContain("### src/example.ts");
    expect(formatted).toContain("```ts\nexport const x = 1;\n```");
    expect(formatted).toContain("### README.md");
    expect(formatted).toContain("```md\n# Project\n```");
  });
});

describe("loadFiles", () => {
  it("loads matching files, respects exclusions, and skips binary/large files", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "codex-orchestrator-files-load-"));
    try {
      mkdirSync(join(baseDir, "src"), { recursive: true });
      mkdirSync(join(baseDir, "tmp"), { recursive: true });
      writeFileSync(join(baseDir, "src", "a.ts"), "export const a = 1;");
      writeFileSync(join(baseDir, "src", "b.ts"), "export const b = 2;");
      writeFileSync(join(baseDir, "tmp", "skip.ts"), "ignore me");
      writeFileSync(join(baseDir, "src", "bin.dat"), "abc\0def");
      writeFileSync(join(baseDir, "src", "big.txt"), "x".repeat(510_000));

      const files = await loadFiles(["src/**/*", "!src/b.ts", "!tmp/**"], baseDir);
      const paths = files.map((f) => f.path).sort();

      expect(paths.join(",")).toContain("src/a.ts");
      expect(paths.includes("src/bin.dat")).toBe(false);
      expect(paths.includes("src/b.ts")).toBe(false);
      expect(paths.includes("src/big.txt")).toBe(false);
      expect(paths.includes("tmp/skip.ts")).toBe(false);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("sorts smaller files first and applies context budget", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "codex-orchestrator-files-budget-"));
    try {
      mkdirSync(join(baseDir, "src"), { recursive: true });
      const small = join(baseDir, "src", "small.ts");
      const medium = join(baseDir, "src", "medium.ts");
      const large = join(baseDir, "src", "large.ts");
      writeFileSync(small, "a");
      writeFileSync(medium, "b".repeat(100));
      writeFileSync(large, "c".repeat(200));

      const now = Date.now() / 1000;
      utimesSync(small, now - 30, now - 30);
      utimesSync(medium, now - 20, now - 20);
      utimesSync(large, now - 10, now - 10);

      const all = await loadFiles(["src/*.ts"], baseDir);
      expect(all[0]?.path).toBe("src/small.ts");

      const budgeted = await loadFiles(["src/*.ts"], baseDir, 30);
      expect(budgeted.length >= 1).toBe(true);
      expect(budgeted.some((f) => f.path === "src/large.ts")).toBe(false);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe("loadCodebaseMap", () => {
  it("prefers docs/CODEBASE_MAP.md and falls back to ARCHITECTURE.md", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "codex-orchestrator-map-"));
    try {
      mkdirSync(join(baseDir, "docs"), { recursive: true });
      writeFileSync(join(baseDir, "docs", "CODEBASE_MAP.md"), "# Primary map");
      writeFileSync(join(baseDir, "docs", "ARCHITECTURE.md"), "# Fallback map");
      expect(await loadCodebaseMap(baseDir)).toContain("Primary map");

      rmSync(join(baseDir, "docs", "CODEBASE_MAP.md"), { force: true });
      expect(await loadCodebaseMap(baseDir)).toContain("Fallback map");
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
