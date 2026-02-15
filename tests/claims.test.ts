import { describe, expect, it } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function runClaimsScript(homeDir: string, scriptBody: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const script = [
    "import { readFileSync, readdirSync } from 'fs';",
    "import { join } from 'path';",
    "const claims = await import('./src/claims.ts');",
    scriptBody,
  ].join("\n");

  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: homeDir,
    },
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("claims lifecycle", () => {
  it("addClaim creates an entry", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "codex-orchestrator-claims-add-"));
    try {
      const result = runClaimsScript(
        homeDir,
        [
          "claims.addClaim('job-a', 'src/**');",
          "console.log(JSON.stringify(claims.listClaims()));",
        ].join("\n")
      );

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as Array<{ jobId?: string; pattern?: string }>;
      expect(parsed.length).toBe(1);
      expect(parsed[0]?.jobId).toBe("job-a");
      expect(parsed[0]?.pattern).toBe("src/**");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("removeClaims removes all claims for a job", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "codex-orchestrator-claims-remove-"));
    try {
      const result = runClaimsScript(
        homeDir,
        [
          "claims.addClaim('job-a', 'src/a/**');",
          "claims.addClaim('job-a', 'src/b/**');",
          "claims.addClaim('job-b', 'src/c/**');",
          "claims.removeClaims('job-a');",
          "console.log(JSON.stringify(claims.listClaims()));",
        ].join("\n")
      );

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as Array<{ jobId?: string }>;
      expect(parsed.length).toBe(1);
      expect(parsed[0]?.jobId).toBe("job-b");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("checkOverlaps detects overlapping patterns", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "codex-orchestrator-claims-overlap-"));
    try {
      const result = runClaimsScript(
        homeDir,
        [
          "claims.addClaim('job-a', 'src/auth/**');",
          "console.log(JSON.stringify(claims.checkOverlaps('job-b', 'src/auth/login.ts')));",
        ].join("\n")
      );

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as Array<{ jobId?: string }>;
      expect(parsed.length).toBe(1);
      expect(parsed[0]?.jobId).toBe("job-a");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("cleanStaleClaims removes claims for non-existent jobs", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "codex-orchestrator-claims-clean-"));
    try {
      const result = runClaimsScript(
        homeDir,
        [
          "claims.addClaim('job-a', 'src/a/**');",
          "claims.addClaim('job-b', 'src/b/**');",
          "claims.addClaim('job-c', 'src/c/**');",
          "const removed = claims.cleanStaleClaims(new Set(['job-b']));",
          "console.log(JSON.stringify({ removed, remaining: claims.listClaims() }));",
        ].join("\n")
      );

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as {
        removed?: number;
        remaining?: Array<{ jobId?: string }>;
      };
      expect(parsed.removed ?? -1).toBe(2);
      expect(parsed.remaining?.length ?? 0).toBe(1);
      expect(parsed.remaining?.[0]?.jobId).toBe("job-b");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("writes claims atomically without corruption", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "codex-orchestrator-claims-atomic-"));
    try {
      const result = runClaimsScript(
        homeDir,
        [
          "for (let i = 0; i < 50; i++) { claims.addClaim(`job-${i}`, `src/${i}/**`); }",
          "const claimsDir = join(process.env.HOME, '.codex-agent');",
          "const claimsFile = join(claimsDir, 'claims.json');",
          "const parsed = JSON.parse(readFileSync(claimsFile, 'utf-8'));",
          "const leftovers = readdirSync(claimsDir).filter((f) => f.endsWith('.tmp'));",
          "console.log(JSON.stringify({ count: parsed.claims.length, leftovers: leftovers.length }));",
        ].join("\n")
      );

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as { count?: number; leftovers?: number };
      expect(parsed.count ?? -1).toBe(50);
      expect(parsed.leftovers ?? -1).toBe(0);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
