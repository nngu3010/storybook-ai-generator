import { glob } from 'glob';
import fs from 'fs/promises';
import path from 'path';
import { isComponent } from './heuristics.js';

/**
 * Finds all React component files in a directory.
 * Globs for .tsx files, excludes noise, runs heuristics.
 */
export async function findComponents(dir: string): Promise<string[]> {
  const resolvedDir = path.resolve(dir);

  const files = await glob('**/*.tsx', {
    cwd: resolvedDir,
    absolute: true,
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/*.test.tsx',
      '**/*.spec.tsx',
      '**/*.stories.tsx',
      '**/__tests__/**',
      '**/__mocks__/**',
    ],
  });

  const components: string[] = [];

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      if (isComponent(filePath, content)) {
        components.push(filePath);
      }
    } catch {
      // Skip files we can't read
    }
  }

  return components.sort();
}
