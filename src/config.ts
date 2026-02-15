// Configuration for codex-agent

const homeDir = process.env.HOME?.trim();
if (!homeDir) {
  throw new Error("HOME environment variable is not set");
}

export const config = {
  // Default model
  model: "gpt-5.3-codex",

  // Reasoning effort levels
  reasoningEfforts: ["low", "medium", "high", "xhigh"] as const,
  defaultReasoningEffort: "xhigh" as const,

  // Sandbox modes
  sandboxModes: ["read-only", "workspace-write", "danger-full-access"] as const,
  defaultSandbox: "workspace-write" as const,

  // Job storage directory
  jobsDir: `${homeDir}/.codex-agent/jobs`,

  // Default inactivity timeout in minutes for running jobs
  defaultTimeout: 60,

  // Default number of jobs to show in listings
  jobsListLimit: 20,

  // tmux session prefix
  tmuxPrefix: "codex-agent",

  // Polling settings for tmux pane readiness checks
  tmuxPollIntervalMs: 100,
  tmuxPollTimeoutMs: 10000,
};

export const statusRank: Record<string, number> = {
  running: 0,
  pending: 1,
  failed: 2,
  cancelled: 3,
  completed: 4,
};

export type ReasoningEffort = typeof config.reasoningEfforts[number];
export type SandboxMode = typeof config.sandboxModes[number];
