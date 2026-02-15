import { describe, expect, it } from "bun:test";
import { formatDuration, stripAnsiCodes } from "../src/cli.ts";

describe("stripAnsiCodes", () => {
  it("removes ANSI color codes", () => {
    const value = "\u001b[32mOK\u001b[0m";
    expect(stripAnsiCodes(value)).toBe("OK");
  });
});

describe("formatDuration", () => {
  it("formats seconds", () => {
    expect(formatDuration(5_000)).toBe("5s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125_000)).toBe("2m 5s");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3_720_000)).toBe("1h 2m");
  });
});
