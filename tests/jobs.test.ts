import { describe, expect, it } from "bun:test";
import { assertValidJobId, generateJobId, type Job } from "../src/jobs.ts";

describe("assertValidJobId", () => {
  it("accepts valid 8-char hex IDs", () => {
    const validIds = ["abcdef12", "ABCDEF12", "1234abcd"];

    for (const id of validIds) {
      expect(() => assertValidJobId(id)).not.toThrow();
    }
  });

  it("rejects path traversal and path-like values", () => {
    const invalidIds = ["../abcd1234", "abcd1234/..", "ab/cd1234", "abcd1234.json"];

    for (const id of invalidIds) {
      expect(() => assertValidJobId(id)).toThrow();
    }
  });

  it("rejects IDs that are too short or too long", () => {
    const invalidIds = ["", "abc1234", "abcdef123"];

    for (const id of invalidIds) {
      expect(() => assertValidJobId(id)).toThrow();
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
    const id = generateJobId();
    expect(id).toMatch(/^[a-f0-9]{8}$/i);
  });
});
