import { execSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import url from 'url';
import { logger } from '../../utils/logger.js';

/**
 * Resolves the storybook-gen project root by walking up from this file's location.
 * Works whether running from dist/ (linked install) or src/ (dev).
 */
function resolveProjectRoot(): string {
  const __filename = url.fileURLToPath(import.meta.url);
  // dist/cli/commands/update.js → up 3 levels = project root
  return path.resolve(path.dirname(__filename), '..', '..', '..');
}

function readVersion(projectRoot: string): string {
  const require = createRequire(import.meta.url);
  try {
    const pkg = require(path.join(projectRoot, 'package.json')) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, stdio: 'pipe' }).toString().trim();
}

export async function runUpdate(): Promise<void> {
  const projectRoot = resolveProjectRoot();
  logger.info(`Updating storybook-gen at: ${projectRoot}`);

  const before = readVersion(projectRoot);
  logger.info(`Current version: ${before}`);

  // Check this is a git repo
  const isGit = (() => {
    try { run('git rev-parse --git-dir', projectRoot); return true; } catch { return false; }
  })();

  let dirty = false;

  if (isGit) {
    // Check for uncommitted changes
    dirty = run('git status --porcelain', projectRoot).length > 0;
    if (dirty) {
      logger.warn('Working directory has uncommitted changes — stashing before pull...');
      run('git stash', projectRoot);
    }

    // Pull latest
    logger.info('Pulling latest changes...');
    try {
      const pullOutput = run('git pull --ff-only', projectRoot);
      if (pullOutput.includes('Already up to date')) {
        logger.info('Already up to date.');
        if (dirty) run('git stash pop', projectRoot);
        logger.info(`Version: ${before} (no change)`);
        return;
      }
      console.log(pullOutput);
    } catch (err) {
      logger.error(`git pull failed: ${(err as Error).message}`);
      if (dirty) run('git stash pop', projectRoot);
      process.exit(1);
    }
  } else {
    logger.warn('No git repository found — skipping pull, rebuilding from source.');
  }

  // Rebuild
  logger.info('Rebuilding...');
  try {
    run('npm run build', projectRoot);
  } catch (err) {
    logger.error(`Build failed: ${(err as Error).message}`);
    if (dirty) run('git stash pop', projectRoot);
    process.exit(1);
  }

  if (dirty) {
    logger.info('Restoring stashed changes...');
    run('git stash pop', projectRoot);
  }

  const after = readVersion(projectRoot);

  console.log('');
  if (before !== after) {
    logger.success(`Updated: ${before} → ${after}`);
  } else {
    logger.success(`Rebuilt successfully (version: ${after})`);
  }
}
