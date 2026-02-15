import { describe, expect, it } from "bun:test";
import { estimateTokens, formatPromptWithFiles } from "../src/files.ts";

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
