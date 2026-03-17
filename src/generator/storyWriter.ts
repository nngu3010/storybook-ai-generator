import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type WriteResult = 'written' | 'skipped' | 'conflict';

export interface WriteOptions {
  overwrite?: boolean;
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
  const dir = path.dirname(componentPath);
  const baseName = path.basename(componentPath).replace(/\.(tsx?|jsx?)$/, '');
  const storyPath = path.join(dir, `${baseName}.stories.ts`);

  if (!fs.existsSync(storyPath)) {
    fs.writeFileSync(storyPath, content, 'utf-8');
    return 'written';
  }

  // Story file already exists — compare checksums
  const existingContent = fs.readFileSync(storyPath, 'utf-8');
  const existingChecksum = extractChecksum(existingContent);
  const newChecksum = extractChecksum(content);

  if (existingChecksum && newChecksum && existingChecksum === newChecksum) {
    return 'skipped';
  }

  if (opts.overwrite) {
    fs.writeFileSync(storyPath, content, 'utf-8');
    return 'written';
  }

  // Write to a .generated.ts file to avoid clobbering manual edits
  const conflictPath = path.join(dir, `${baseName}.stories.generated.ts`);
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
