// File loading utilities for context injection

import { glob } from "glob";
import { readFileSync, statSync } from "fs";
import { resolve, relative } from "path";

export interface FileContent {
  path: string;
  content: string;
  size: number;
  modifiedAt: string;
}

export async function loadFiles(
  patterns: string[],
  baseDir: string = process.cwd(),
  contextBudget?: number
): Promise<FileContent[]> {
  const files: FileContent[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    // Handle negation patterns
    if (pattern.startsWith("!")) {
      const negPattern = pattern.slice(1);
      const matches = await glob(negPattern, { cwd: baseDir, absolute: true });
      for (const match of matches) {
        seen.delete(match);
      }
      continue;
    }

    const matches = await glob(pattern, { cwd: baseDir, absolute: true });

    for (const match of matches) {
      if (seen.has(match)) continue;

      try {
        const stat = statSync(match);
        if (!stat.isFile()) continue;

        // Skip binary files and very large files
        if (stat.size > 500000) continue; // 500KB limit

        const content = readFileSync(match, "utf-8");

        // Skip binary content
        if (content.includes("\0")) continue;

        seen.add(match);
        files.push({
          path: relative(baseDir, match),
          content,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {
        // Skip files we can't read
      }
    }
  }

  // Prioritize: smaller files first, more recently modified break ties
  files.sort((a, b) => {
    const sizeDiff = a.size - b.size;
    if (sizeDiff !== 0) return sizeDiff;
    return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
  });

  // Apply context budget if specified
  if (contextBudget && contextBudget > 0) {
    return applyContextBudget(files, contextBudget);
  }

  return files;
}

/**
 * Estimate token count using a more accurate heuristic.
 * Accounts for whitespace density and code patterns.
 */
export function estimateTokens(text: string): number {
  // Count words (roughly 1 token each)
  const words = text.split(/\s+/).filter(Boolean).length;
  // Count punctuation/symbols (often separate tokens)
  const symbols = (text.match(/[{}()\[\];:.,<>!=+\-*/&|^~?@#$%]/g) || []).length;
  // Estimate: words + symbols, with a floor of length/4
  const estimate = words + Math.floor(symbols * 0.5);
  return Math.max(estimate, Math.ceil(text.length / 4));
}

/**
 * Apply a token budget to limit total context size.
 * Keeps highest-priority files (smallest, most recent) until budget is exhausted.
 */
function applyContextBudget(files: FileContent[], budgetTokens: number): FileContent[] {
  const result: FileContent[] = [];
  let usedTokens = 0;

  for (const file of files) {
    const fileTokens = estimateTokens(file.content);
    // Account for formatting overhead (header, code fences, etc.)
    const overhead = estimateTokens(`### ${file.path}\n\n\`\`\`\n\`\`\`\n\n`);
    const totalCost = fileTokens + overhead;

    if (usedTokens + totalCost > budgetTokens) continue;

    result.push(file);
    usedTokens += totalCost;
  }

  return result;
}

export function formatPromptWithFiles(
  prompt: string,
  files: FileContent[]
): string {
  if (files.length === 0) return prompt;

  let result = prompt + "\n\n---\n\n## File Context\n\n";

  // Add summary header with metadata
  const totalTokens = files.reduce((sum, f) => sum + estimateTokens(f.content), 0);
  result += `*${files.length} files, ~${totalTokens.toLocaleString()} tokens*\n\n`;

  for (const file of files) {
    const ext = file.path.split(".").pop() || "";
    const sizeKb = (file.size / 1024).toFixed(1);
    const modified = file.modifiedAt.slice(0, 10);
    result += `### ${file.path} *(${sizeKb}KB, ${modified})*\n\n\`\`\`${ext}\n${file.content}\n\`\`\`\n\n`;
  }

  return result;
}

export async function loadCodebaseMap(cwd: string): Promise<string | null> {
  const mapPaths = [
    resolve(cwd, "docs/CODEBASE_MAP.md"),
    resolve(cwd, "CODEBASE_MAP.md"),
    resolve(cwd, "docs/ARCHITECTURE.md"),
  ];

  for (const mapPath of mapPaths) {
    try {
      const content = readFileSync(mapPath, "utf-8");
      return content;
    } catch {
      // Try next path
    }
  }

  return null;
}
