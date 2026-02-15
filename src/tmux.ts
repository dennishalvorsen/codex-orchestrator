// tmux helper functions for codex-agent

import { spawnSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { config } from "./config.ts";

export interface TmuxSession {
  name: string;
  attached: boolean;
  windows: number;
  created: string;
}

const ALLOWED_CONTROL_KEYS = new Set(["C-c", "C-z", "Enter", "Escape"]);

function shQuote(v: string): string {
  return "'" + v.replace(/'/g, "'\\\"'\\\"'") + "'";
}

function assertSafeModel(model: string): void {
  if (!/^[a-zA-Z0-9._:-]+$/.test(model)) {
    throw new Error("Invalid model: " + model);
  }
}

function toErrorMessage(stderr: string | Buffer | null | undefined): string {
  if (typeof stderr === "string") {
    return stderr.trim();
  }
  if (stderr) {
    return stderr.toString("utf-8").trim();
  }
  return "";
}

function runTmux(args: string[], cwd?: string): void {
  const result = spawnSync("tmux", args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(toErrorMessage(result.stderr) || `tmux ${args[0]} failed`);
  }
}

function runTmuxOutput(
  args: string[],
  options: { cwd?: string; maxBuffer?: number } = {}
): string {
  const result = spawnSync("tmux", args, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    cwd: options.cwd,
    maxBuffer: options.maxBuffer,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(toErrorMessage(result.stderr) || `tmux ${args[0]} failed`);
  }

  return result.stdout;
}

function waitForPaneContent(
  sessionName: string,
  timeoutMs: number = config.tmuxPollTimeoutMs
): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = spawnSync("tmux", ["capture-pane", "-t", sessionName, "-p"], {
        encoding: "utf-8",
      });
      if (result.stdout && result.stdout.trim().length > 0) {
        return true;
      }
    } catch {}
    spawnSync("sleep", [String(config.tmuxPollIntervalMs / 1000)]);
  }
  return false;
}

export function incrementalDiff(prev: string, curr: string): string {
  if (!prev) return curr;

  const prevLines = prev.split("\n");
  const currLines = curr.split("\n");
  const maxOverlap = Math.min(prevLines.length, currLines.length);

  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    const prevTail = prevLines.slice(-overlap).join("\n");
    const currHead = currLines.slice(0, overlap).join("\n");
    if (prevTail === currHead) {
      return currLines.slice(overlap).join("\n");
    }
  }

  return curr;
}

/**
 * Validate a job ID (must be hex string, 8 chars)
 */
export function validateJobId(jobId: string): boolean {
  return /^[0-9a-f]{1,16}$/.test(jobId);
}

/**
 * Send text to a tmux session safely using load-buffer + paste-buffer.
 * This avoids all shell escaping issues with send-keys.
 */
function safeSendText(sessionName: string, text: string): void {
  const tmpFile = join(config.jobsDir, `.tmux-buf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    writeFileSync(tmpFile, text);
    runTmux(["load-buffer", tmpFile]);
    runTmux(["paste-buffer", "-t", sessionName]);
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

/**
 * Get tmux session name for a job
 */
export function getSessionName(jobId: string): string {
  if (!validateJobId(jobId)) {
    throw new Error(`Invalid job ID: ${jobId}`);
  }
  return `${config.tmuxPrefix}-${jobId}`;
}

/**
 * Check if tmux is available
 */
export function isTmuxAvailable(): boolean {
  const result = spawnSync("tmux", ["-V"], { stdio: ["pipe", "pipe", "pipe"] });
  return result.status === 0;
}

/**
 * Check if a tmux session exists
 */
export function sessionExists(sessionName: string): boolean {
  const result = spawnSync("tmux", ["has-session", "-t", sessionName], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result.status === 0;
}

/**
 * Create a new tmux session running codex (interactive mode)
 */
export function createSession(options: {
  jobId: string;
  prompt: string;
  model: string;
  reasoningEffort: string;
  sandbox: string;
  cwd: string;
}): { sessionName: string; success: boolean; error?: string } {
  const sessionName = getSessionName(options.jobId);
  const logFile = `${config.jobsDir}/${options.jobId}.log`;

  // Create prompt file to avoid shell escaping issues
  const promptFile = `${config.jobsDir}/${options.jobId}.prompt`;

  try {
    // Validate jobId to prevent injection
    if (!validateJobId(options.jobId)) {
      return { sessionName, success: false, error: "Invalid job ID format" };
    }
    assertSafeModel(options.model);
    writeFileSync(promptFile, options.prompt);

    // Build the codex command (interactive mode)
    // We use the interactive TUI so we can send messages later
    const codexArgs = [
      "-c", `model="${options.model}"`,
      "-c", `model_reasoning_effort="${options.reasoningEffort}"`,
      "-c", "skip_update_check=true",
      "-a", "never",
      "-s", options.sandbox,
    ]
      .map(shQuote)
      .join(" ");

    // Create tmux session with codex running
    // Use script to capture all output, and keep shell alive after codex exits
    const shellCmd =
      `script -q ${shQuote(logFile)} codex ${codexArgs}; ` +
      `echo "\\n\\n[codex-agent: Session complete. Press Enter to close.]"; read`;

    runTmux(
      ["new-session", "-d", "-s", sessionName, "-c", options.cwd, shellCmd],
      options.cwd
    );

    // Give codex a moment to initialize and show update prompt if any
    waitForPaneContent(sessionName);

    // Skip update prompt if it appears by sending "3" (skip until next version)
    // Then Enter to dismiss any remaining prompts
    runTmux(["send-keys", "-t", sessionName, "3"]);
    waitForPaneContent(sessionName);
    runTmux(["send-keys", "-t", sessionName, "Enter"]);
    waitForPaneContent(sessionName);

    // Always use load-buffer + paste-buffer for safe prompt delivery
    // This avoids all shell escaping issues regardless of prompt content
    safeSendText(sessionName, options.prompt);
    spawnSync("sleep", ["0.3"]);
    runTmux(["send-keys", "-t", sessionName, "Enter"]);

    return { sessionName, success: true };
  } catch (err) {
    // Clean up prompt file on failure too
    try { unlinkSync(promptFile); } catch { /* ignore */ }
    return {
      sessionName,
      success: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Send a message to a running codex session.
 * Uses load-buffer + paste-buffer for safe delivery regardless of message content.
 */
export function sendMessage(sessionName: string, message: string): boolean {
  if (!sessionExists(sessionName)) {
    return false;
  }

  try {
    safeSendText(sessionName, message);
    // Small delay before Enter for TUI to process
    spawnSync("sleep", ["0.1"]);
    runTmux(["send-keys", "-t", sessionName, "Enter"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a control key to a session (like Ctrl+C)
 */
export function sendControl(sessionName: string, key: string): boolean {
  if (!ALLOWED_CONTROL_KEYS.has(key)) {
    return false;
  }

  if (!sessionExists(sessionName)) {
    return false;
  }

  try {
    runTmux(["send-keys", "-t", sessionName, key]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture the current pane content
 */
export function capturePane(
  sessionName: string,
  options: { lines?: number; start?: number } = {}
): string | null {
  if (!sessionExists(sessionName)) {
    return null;
  }

  try {
    const args = ["capture-pane", "-t", sessionName, "-p"];

    if (options.start !== undefined) {
      args.push("-S", String(options.start));
    }

    const output = runTmuxOutput(args);

    if (options.lines) {
      const allLines = output.split("\n");
      return allLines.slice(-options.lines).join("\n");
    }

    return output;
  } catch {
    return null;
  }
}

/**
 * Get the full scrollback buffer
 */
export function captureFullHistory(sessionName: string): string | null {
  if (!sessionExists(sessionName)) {
    return null;
  }

  try {
    // Capture from start of history (-S -) to end
    const output = runTmuxOutput(
      ["capture-pane", "-t", sessionName, "-p", "-S", "-"],
      { maxBuffer: 50 * 1024 * 1024 }
    );
    return output;
  } catch {
    return null;
  }
}

/**
 * Kill a tmux session
 */
export function killSession(sessionName: string): boolean {
  if (!sessionExists(sessionName)) {
    return false;
  }

  try {
    runTmux(["kill-session", "-t", sessionName]);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all codex-agent sessions
 */
export function listSessions(): TmuxSession[] {
  try {
    const output = runTmuxOutput([
      "list-sessions",
      "-F",
      "#{session_name}|#{session_attached}|#{session_windows}|#{session_created}",
    ]);

    return output
      .trim()
      .split("\n")
      .filter((line) => line.startsWith(config.tmuxPrefix))
      .map((line): TmuxSession | null => {
        const [name, attached, windows, created] = line.split("|");
        if (
          name === undefined ||
          attached === undefined ||
          windows === undefined ||
          created === undefined
        ) {
          return null;
        }

        const windowsCount = parseInt(windows, 10);
        const createdEpoch = parseInt(created, 10);
        return {
          name,
          attached: attached === "1",
          windows: Number.isNaN(windowsCount) ? 0 : windowsCount,
          created: Number.isNaN(createdEpoch)
            ? new Date(0).toISOString()
            : new Date(createdEpoch * 1000).toISOString(),
        };
      })
      .filter((session): session is TmuxSession => session !== null);
  } catch {
    return [];
  }
}

/**
 * Get the command to attach to a session (for display to user)
 */
export function getAttachCommand(sessionName: string): string {
  return `tmux attach -t "${sessionName}"`;
}

/**
 * Check if the session's codex process is still running
 */
export function isSessionActive(sessionName: string): boolean {
  if (!sessionExists(sessionName)) {
    return false;
  }

  try {
    // Check if the pane has a running process
    const pid = runTmuxOutput(["list-panes", "-t", sessionName, "-F", "#{pane_pid}"]).trim();

    if (!pid) return false;

    // Check if that process is still running
    process.kill(parseInt(pid, 10), 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Heartbeat check: verify the Codex process is actually alive and responsive.
 * Returns true if pane has a live process with child processes (codex running).
 */
export function heartbeat(sessionName: string): { alive: boolean; pid: number | null } {
  if (!sessionExists(sessionName)) {
    return { alive: false, pid: null };
  }

  try {
    const pidStr = runTmuxOutput(
      ["list-panes", "-t", sessionName, "-F", "#{pane_pid}"]
    ).trim();

    if (!pidStr) return { alive: false, pid: null };
    const pid = parseInt(pidStr, 10);

    // Check if process exists
    try {
      process.kill(pid, 0);
    } catch {
      return { alive: false, pid };
    }

    // Check if process has child processes (codex running under script)
    try {
      const result = spawnSync("pgrep", ["-P", String(pid)], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const children = (result.stdout || "").trim();
      return { alive: children.length > 0, pid };
    } catch {
      // pgrep returns non-zero if no children found
      return { alive: true, pid }; // Parent alive but no children might be ok
    }
  } catch {
    return { alive: false, pid: null };
  }
}

/**
 * Watch a session's output (returns a stream of updates)
 * This is for programmatic watching - for interactive use, just attach
 */
export function watchSession(
  sessionName: string,
  callback: (content: string) => void,
  intervalMs: number = 1000
): { stop: () => void } {
  let lastContent = "";
  let running = true;

  const interval = setInterval(() => {
    if (!running) return;

    const content = capturePane(sessionName, { lines: 100 });
    if (content && content !== lastContent) {
      // Only send the new lines
      const newContent = incrementalDiff(lastContent, content);
      if (newContent) {
        callback(newContent);
      }
      lastContent = content;
    }

    // Check if session still exists
    if (!sessionExists(sessionName)) {
      running = false;
      clearInterval(interval);
    }
  }, intervalMs);

  return {
    stop: () => {
      running = false;
      clearInterval(interval);
    },
  };
}
