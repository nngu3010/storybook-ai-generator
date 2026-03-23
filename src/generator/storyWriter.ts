import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type WriteResult = 'written' | 'skipped' | 'conflict';

export interface WriteOptions {
  overwrite?: boolean;
  /** Explicit output path — overrides the default co-located story path. */
  outputPath?: string;
}

/**
 * Computes the story output path for a component.
 * With `outputDir`, mirrors the source structure under the output directory.
 * Without it, returns the co-located path next to the component.
 */
export function computeStoryPath(
  componentPath: string,
  scanDir: string,
  outputDir?: string,
): string {
  const baseName = path.basename(componentPath).replace(/\.(tsx?|jsx?)$/, '');
  const storyFileName = `${baseName}.stories.ts`;

  if (!outputDir) {
    return path.join(path.dirname(componentPath), storyFileName);
  }

  const relativeFromScan = path.relative(scanDir, componentPath);
  return path.join(outputDir, path.dirname(relativeFromScan), storyFileName);
}

/**
 * Computes the import path from a story file back to its source component.
 * Returns a relative path without extension, suitable for a TS import statement.
 */
export function computeImportPath(
  storyPath: string,
  componentPath: string,
): string {
  const rel = path.relative(path.dirname(storyPath), componentPath);
  const withoutExt = rel.replace(/\.(tsx?|jsx?)$/, '');
  if (!withoutExt.startsWith('.')) return `./${withoutExt}`;
  return withoutExt;
}

/**
 * Writes a generated story file next to the component.
 *
 * Rules:
 *  - If no story exists: write `ComponentName.stories.ts`
 *  - If story exists AND checksums match: skip (no change)
 *  - If story exists AND checksums differ AND overwrite=false: write `.stories.generated.ts`
 *  - If story exists AND checksums differ AND overwrite=true: overwrite
 */
export function writeStory(
  componentPath: string,
  content: string,
  opts: WriteOptions = {}
): WriteResult {
  const baseName = path.basename(componentPath).replace(/\.(tsx?|jsx?)$/, '');
  const storyPath = opts.outputPath ?? path.join(path.dirname(componentPath), `${baseName}.stories.ts`);
  const dir = path.dirname(storyPath);

  if (!fs.existsSync(storyPath)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(storyPath, content, 'utf-8');
    return 'written';
  }

  // Story file already exists — compare checksums
  const existingContent = fs.readFileSync(storyPath, 'utf-8');
  const existingChecksum = extractChecksum(existingContent);
  const newChecksum = extractChecksum(content);

  if (existingChecksum && newChecksum && existingChecksum === newChecksum && !opts.overwrite) {
    return 'skipped';
  }

  if (opts.overwrite) {
    fs.writeFileSync(storyPath, content, 'utf-8');
    return 'written';
  }

  // Write to a .generated.ts file to avoid clobbering manual edits
  const conflictPath = path.join(path.dirname(storyPath), `${baseName}.stories.generated.ts`);
  fs.writeFileSync(conflictPath, content, 'utf-8');
  return 'conflict';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the checksum from the header comment line:
 * `// @sbook-ai checksum: {hash} generated: {date}`
 */
function extractChecksum(content: string): string | null {
  const match = content.match(/\/\/ @sbook-ai checksum: ([a-f0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Computes a sha1 hash of arbitrary content (utility, not currently used
 * in writeStory but exported for consumers).
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 12);
}
