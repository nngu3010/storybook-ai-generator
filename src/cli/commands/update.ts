import { execSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import url from 'url';
import { logger } from '../../utils/logger.js';

const PACKAGE_NAME = 'storybook-ai-generator';

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

/** Check if this installation is a git clone (dev) vs npm install. */
function isGitInstall(projectRoot: string): boolean {
  try {
    run('git rev-parse --git-dir', projectRoot);
    return true;
  } catch {
    return false;
  }
}

/** Fetch the latest version from the npm registry. */
function fetchLatestVersion(): string | undefined {
  try {
    return run(`npm view ${PACKAGE_NAME} version`, process.cwd());
  } catch {
    return undefined;
  }
}

export async function runUpdate(): Promise<void> {
  const projectRoot = resolveProjectRoot();
  const currentVersion = readVersion(projectRoot);
  logger.info(`Current version: ${currentVersion}`);

  if (isGitInstall(projectRoot)) {
    await updateFromGit(projectRoot, currentVersion);
  } else {
    await updateFromNpm(currentVersion);
  }
}

async function updateFromNpm(currentVersion: string): Promise<void> {
  logger.info('Checking npm registry for updates...');

  const latest = fetchLatestVersion();
  if (!latest) {
    logger.error(`Could not reach npm registry for ${PACKAGE_NAME}.`);
    process.exit(1);
  }

  if (latest === currentVersion) {
    logger.success(`Already on the latest version (${currentVersion}).`);
    return;
  }

  logger.info(`New version available: ${currentVersion} → ${latest}`);
  logger.info('Installing update...');

  try {
    const output = run(`npm install -g ${PACKAGE_NAME}@latest`, process.cwd());
    if (output) console.log(output);
    logger.success(`Updated: ${currentVersion} → ${latest}`);
  } catch (err) {
    logger.error(`npm install failed: ${(err as Error).message}`);
    logger.info(`You can update manually: npm install -g ${PACKAGE_NAME}@latest`);
    process.exit(1);
  }
}

async function updateFromGit(projectRoot: string, currentVersion: string): Promise<void> {
  logger.info(`Updating from git at: ${projectRoot}`);

  // Check for uncommitted changes
  const dirty = run('git status --porcelain', projectRoot).length > 0;
  if (dirty) {
    logger.warn('Working directory has uncommitted changes — stashing before pull...');
    run('git stash', projectRoot);
  }

  try {
    logger.info('Pulling latest changes...');
    const pullOutput = run('git pull --ff-only', projectRoot);
    if (pullOutput.includes('Already up to date')) {
      logger.info('Already up to date.');
      if (dirty) run('git stash pop', projectRoot);
      logger.info(`Version: ${currentVersion} (no change)`);
      return;
    }
    console.log(pullOutput);

    logger.info('Rebuilding...');
    run('npm run build', projectRoot);

    if (dirty) {
      logger.info('Restoring stashed changes...');
      run('git stash pop', projectRoot);
    }

    const after = readVersion(projectRoot);
    console.log('');
    if (currentVersion !== after) {
      logger.success(`Updated: ${currentVersion} → ${after}`);
    } else {
      logger.success(`Rebuilt successfully (version: ${after})`);
    }
  } catch (err) {
    if (dirty) {
      try { run('git stash pop', projectRoot); } catch { /* ignore */ }
    }
    logger.error(`Update failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
