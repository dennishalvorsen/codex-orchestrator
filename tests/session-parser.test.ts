import { describe, expect, it } from "bun:test";
import { extractSessionId, parseJsonlSession, stripAnsiCodes } from "../src/session-parser.ts";

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
