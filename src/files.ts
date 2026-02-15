// File loading utilities for context injection

import { glob } from "glob";
import { readFileSync, statSync } from "fs";
import { resolve, relative } from "path";
import { encodingForModel, getEncoding, type Tiktoken } from "js-tiktoken";

export interface FileContent {
  path: string;
  content: string;
  size: number;
  modifiedAt: string;
}

const encoderCache = new Map<string, Tiktoken>();

export async function loadFiles(
  patterns: string[],
  baseDir: string = process.cwd(),
  contextBudget?: number
): Promise<FileContent[]> {
  const files: FileContent[] = [];
  const seen = new Set<string>();

  const includes = patterns.filter((pattern) => !pattern.startsWith("!"));
  const excludes = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1));

  if (includes.length === 0) return files;

  const matches = await glob(includes, {
    cwd: baseDir,
    absolute: true,
    nodir: true,
    ignore: excludes,
  });

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

export function estimateTokens(
  text: string,
  model: string = "gpt-5.3-codex"
): number {
  try {
    let enc = encoderCache.get(model);
    if (!enc) {
      try {
        enc = encodingForModel(model as any);
      } catch {
        enc = getEncoding("o200k_base");
      }
      encoderCache.set(model, enc);
    }
    return enc.encode(text).length;
  } catch {
    return Math.ceil(text.length / 3.8);
  }
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
