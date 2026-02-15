// File ownership claims to prevent multi-agent edit conflicts

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { config } from "./config.ts";

export interface Claim {
  jobId: string;
  pattern: string;
  claimedAt: string;
}

export interface ClaimsData {
  claims: Claim[];
}

const CLAIMS_DIR = `${process.env.HOME}/.codex-agent`;
const CLAIMS_FILE = join(CLAIMS_DIR, "claims.json");

function ensureClaimsDir(): void {
  mkdirSync(CLAIMS_DIR, { recursive: true });
}

function loadClaims(): ClaimsData {
  ensureClaimsDir();
  try {
    const content = readFileSync(CLAIMS_FILE, "utf-8");
    return JSON.parse(content) as ClaimsData;
  } catch {
    return { claims: [] };
  }
}

function saveClaims(data: ClaimsData): void {
  ensureClaimsDir();
  writeFileSync(CLAIMS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Register a file pattern claim for a job
 */
export function addClaim(jobId: string, pattern: string): void {
  const data = loadClaims();
  data.claims.push({
    jobId,
    pattern,
    claimedAt: new Date().toISOString(),
  });
  saveClaims(data);
}

/**
 * Remove all claims for a job
 */
export function removeClaims(jobId: string): void {
  const data = loadClaims();
  data.claims = data.claims.filter((c) => c.jobId !== jobId);
  saveClaims(data);
}

/**
 * Get all active claims
 */
export function listClaims(): Claim[] {
  return loadClaims().claims;
}

/**
 * Check if a pattern overlaps with existing claims from other jobs.
 * Uses simple prefix/glob matching.
 */
export function checkOverlaps(jobId: string, pattern: string): Claim[] {
  const data = loadClaims();
  const overlaps: Claim[] = [];

  for (const claim of data.claims) {
    if (claim.jobId === jobId) continue;
    if (patternsOverlap(pattern, claim.pattern)) {
      overlaps.push(claim);
    }
  }

  return overlaps;
}

/**
 * Simple overlap detection between two glob-like patterns.
 * Checks if patterns share a common prefix or one contains the other.
 */
function patternsOverlap(a: string, b: string): boolean {
  // Strip glob wildcards to get the directory prefix
  const prefixA = a.replace(/\*.*$/, "").replace(/\{.*$/, "");
  const prefixB = b.replace(/\*.*$/, "").replace(/\{.*$/, "");

  // One is a prefix of the other means they can overlap
  if (prefixA.startsWith(prefixB) || prefixB.startsWith(prefixA)) {
    return true;
  }

  // Exact match
  if (a === b) return true;

  return false;
}

/**
 * Clean up claims for jobs that no longer exist
 */
export function cleanStaleClaims(activeJobIds: Set<string>): number {
  const data = loadClaims();
  const before = data.claims.length;
  data.claims = data.claims.filter((c) => activeJobIds.has(c.jobId));
  saveClaims(data);
  return before - data.claims.length;
}
