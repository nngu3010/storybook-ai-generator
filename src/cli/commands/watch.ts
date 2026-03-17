import path from 'path';
import chokidar from 'chokidar';
import { buildProgram } from '../../parser/programBuilder.js';
import { parseComponent } from '../../parser/componentParser.js';
import { buildStoryContent } from '../../generator/storyBuilder.js';
import { writeStory } from '../../generator/storyWriter.js';
import { findComponents } from '../../detector/componentFinder.js';
import { isComponent } from '../../detector/heuristics.js';
import fs from 'fs';
import { logger } from '../../utils/logger.js';

export interface WatchOptions {
  overwrite?: boolean;
}

export async function runWatch(dir: string, opts: WatchOptions = {}): Promise<void> {
  const resolvedDir = path.resolve(dir);

  if (!fs.existsSync(resolvedDir)) {
    logger.error(`Directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  logger.info(`Watching for component changes in: ${resolvedDir}`);
  logger.info('Press Ctrl+C to stop.\n');

  // Initial scan
  const componentFiles = await findComponents(resolvedDir);
  logger.info(`Found ${componentFiles.length} component(s) on startup`);

  let project = buildProgram(resolvedDir, componentFiles);

  const processFile = (filePath: string): void => {
    // Skip story files, tests, etc.
    if (/\.(stories|test|spec)\.(tsx?|jsx?)$/.test(filePath)) return;
    if (!filePath.endsWith('.tsx') && !filePath.endsWith('.jsx')) return;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!isComponent(filePath, content)) return;

      // Rebuild project to pick up the changed file
      const allFiles = findAllTsx(resolvedDir);
      project = buildProgram(resolvedDir, allFiles);

      const meta = parseComponent(project, filePath);

      if (meta.skipReason) {
        logger.skip(`${path.basename(filePath)}: ${meta.skipReason}`);
        return;
      }

      const storyContent = buildStoryContent(meta, path.basename(filePath));
      const result = writeStory(filePath, storyContent, { overwrite: opts.overwrite });

      switch (result) {
        case 'written':
          logger.success(`[watch] Generated story for ${meta.name}`);
          break;
        case 'skipped':
          logger.skip(`[watch] ${meta.name}: story already up-to-date`);
          break;
        case 'conflict':
          logger.warn(`[watch] Conflict for ${meta.name} — wrote .stories.generated.ts`);
          break;
      }
    } catch (err) {
      logger.error(`[watch] Failed to process ${path.basename(filePath)}: ${(err as Error).message}`);
    }
  };

  const watcher = chokidar.watch('**/*.{tsx,jsx}', {
    cwd: resolvedDir,
    ignored: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/*.stories.*',
      '**/*.test.*',
      '**/*.spec.*',
    ],
    ignoreInitial: true,
    persistent: true,
  });

  watcher
    .on('add', (rel) => {
      logger.info(`[watch] New file: ${rel}`);
      processFile(path.join(resolvedDir, rel));
    })
    .on('change', (rel) => {
      logger.info(`[watch] Changed: ${rel}`);
      processFile(path.join(resolvedDir, rel));
    })
    .on('unlink', (rel) => {
      const filePath = path.join(resolvedDir, rel);
      const baseName = path.basename(filePath).replace(/\.(tsx?|jsx?)$/, '');
      const storyPath = path.join(path.dirname(filePath), `${baseName}.stories.ts`);
      if (fs.existsSync(storyPath)) {
        fs.unlinkSync(storyPath);
        logger.warn(`[watch] Deleted story for removed component: ${baseName}.stories.ts`);
      }
    })
    .on('error', (err) => logger.error(`[watch] Watcher error: ${err.message}`));

  // Keep process alive
  process.on('SIGINT', () => {
    watcher.close();
    console.log('');
    logger.info('[watch] Stopped.');
    process.exit(0);
  });
}

function findAllTsx(dir: string): string[] {
  const results: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'build', '.git'].includes(entry.name)) continue;
        walk(full);
      } else if (/\.(tsx|jsx)$/.test(entry.name) && !/\.(stories|test|spec)\./.test(entry.name)) {
        results.push(full);
      }
    }
  };
  walk(dir);
  return results;
}
