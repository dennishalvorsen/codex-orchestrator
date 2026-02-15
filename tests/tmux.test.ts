import { describe, expect, it } from "bun:test";
import { incrementalDiff } from "../src/tmux.ts";

describe("incrementalDiff", () => {
  it("returns current output when previous output is empty", () => {
    const curr = "line1\nline2";
    expect(incrementalDiff("", curr)).toBe(curr);
  });

  it("returns empty string for identical input", () => {
    const text = "same\ncontent";
    expect(incrementalDiff(text, text)).toBe("");
  });

  it("returns full current output when there is no overlap", () => {
    const prev = "a\nb\nc";
    const curr = "x\ny\nz";
    expect(incrementalDiff(prev, curr)).toBe(curr);
  });

  it("handles partial overlap", () => {
    const prev = "a\nb\nc";
    const curr = "b\nc\nd";
    expect(incrementalDiff(prev, curr)).toBe("d");
  });

  it("handles rolling overlap across shifted windows", () => {
    const prev = "line1\nline2\nline3\nline4";
    const curr = "line3\nline4\nline5\nline6";
    expect(incrementalDiff(prev, curr)).toBe("line5\nline6");
  });
});
