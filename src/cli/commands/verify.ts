import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { findComponents } from '../../detector/componentFinder.js';
import { buildProgram } from '../../parser/programBuilder.js';
import { parseComponent } from '../../parser/componentParser.js';
import { buildStoryContent } from '../../generator/storyBuilder.js';
import { logger } from '../../utils/logger.js';

export interface VerifyOptions {
  typecheck?: boolean;
}

interface VerifyResult {
  total: number;
  valid: number;
  outdated: number;
  missing: number;
  typeErrors: number;
  details: Array<{ component: string; status: 'valid' | 'outdated' | 'missing' | 'type-error'; message?: string }>;
}

/**
 * Verifies generated stories are in sync with components and optionally typechecks them.
 * Returns exit code 0 if all good, 1 if issues found.
 */
export async function runVerify(dir: string, opts: VerifyOptions = {}): Promise<number> {
  const resolvedDir = path.resolve(dir);
  logger.info(`Verifying stories in: ${resolvedDir}`);

  const componentFiles = await findComponents(resolvedDir);
  logger.info(`Found ${componentFiles.length} component(s)`);

  if (componentFiles.length === 0) {
    logger.warn('No components found.');
    return 0;
  }

  const project = buildProgram(resolvedDir, componentFiles);
  const result: VerifyResult = { total: 0, valid: 0, outdated: 0, missing: 0, typeErrors: 0, details: [] };

  for (const filePath of componentFiles) {
    const meta = parseComponent(project, filePath);
    if (meta.skipReason) continue;

    result.total++;
    const baseName = path.basename(filePath).replace(/\.(tsx?|jsx?)$/, '');
    const storyPath = path.join(path.dirname(filePath), `${baseName}.stories.ts`);

    // Check 1: Story file exists
    if (!fs.existsSync(storyPath)) {
      result.missing++;
      result.details.push({ component: meta.name, status: 'missing', message: 'No story file found' });
      logger.warn(`${meta.name}: story file missing`);
      continue;
    }

    // Check 2: Checksum matches (story is up-to-date with component props)
    const existingContent = fs.readFileSync(storyPath, 'utf-8');
    const existingChecksum = extractChecksum(existingContent);
    const freshContent = buildStoryContent(meta, path.basename(filePath));
    const freshChecksum = extractChecksum(freshContent);

    if (existingChecksum && freshChecksum && existingChecksum !== freshChecksum) {
      result.outdated++;
      result.details.push({ component: meta.name, status: 'outdated', message: 'Props changed since story was generated' });
      logger.warn(`${meta.name}: story is outdated (props changed)`);
      continue;
    }

    result.valid++;
    result.details.push({ component: meta.name, status: 'valid' });
    logger.success(`${meta.name}: in sync`);
  }

  // Check 3: TypeScript validation (optional)
  if (opts.typecheck) {
    logger.info('');
    logger.info('Running TypeScript validation on generated stories...');
    const typeErrors = await typecheckStories(resolvedDir, componentFiles, project);
    result.typeErrors = typeErrors.length;

    for (const err of typeErrors) {
      result.details.push({ component: err.file, status: 'type-error', message: err.message });
      logger.error(`TypeScript error in ${err.file}: ${err.message}`);
    }
  }

  // Summary
  console.log('');
  logger.info('Verification Summary:');
  logger.info(`  Components:    ${result.total}`);
  if (result.valid > 0) logger.success(`  In sync:       ${result.valid}`);
  if (result.missing > 0) logger.warn(`  Missing:       ${result.missing}`);
  if (result.outdated > 0) logger.warn(`  Outdated:      ${result.outdated}`);
  if (result.typeErrors > 0) logger.error(`  Type errors:   ${result.typeErrors}`);

  const hasIssues = result.missing > 0 || result.outdated > 0 || result.typeErrors > 0;

  if (hasIssues) {
    console.log('');
    if (result.missing > 0 || result.outdated > 0) {
      logger.info('Run `sbook-ai generate <dir>` to fix missing/outdated stories.');
    }
    return 1;
  }

  console.log('');
  logger.success('All stories are valid and in sync!');
  return 0;
}

function extractChecksum(content: string): string | null {
  const match = content.match(/\/\/ @sbook-ai checksum: ([a-f0-9]+)/);
  return match ? match[1] : null;
}

interface TypeErrorInfo {
  file: string;
  message: string;
}

async function typecheckStories(dir: string, componentFiles: string[], project: ReturnType<typeof buildProgram>): Promise<TypeErrorInfo[]> {
  // Find all .stories.ts files in the directory
  const storyFiles: string[] = [];
  for (const filePath of componentFiles) {
    const baseName = path.basename(filePath).replace(/\.(tsx?|jsx?)$/, '');
    const storyPath = path.join(path.dirname(filePath), `${baseName}.stories.ts`);
    if (fs.existsSync(storyPath)) {
      storyFiles.push(storyPath);
    }
  }

  if (storyFiles.length === 0) return [];

  // Look for tsconfig in the project
  const tsconfigCandidates = [
    path.join(dir, 'tsconfig.json'),
    path.join(dir, '..', 'tsconfig.json'),
    path.join(dir, '..', '..', 'tsconfig.json'),
  ];

  let tsconfigPath: string | undefined;
  for (const candidate of tsconfigCandidates) {
    if (fs.existsSync(candidate)) {
      tsconfigPath = candidate;
      break;
    }
  }

  if (!tsconfigPath) {
    logger.warn('No tsconfig.json found — skipping TypeScript validation');
    return [];
  }

  try {
    execSync(`npx tsc --noEmit --project ${tsconfigPath}`, {
      cwd: path.dirname(tsconfigPath),
      stdio: 'pipe',
      timeout: 60000,
    });
    return [];
  } catch (err: any) {
    const output = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
    const errors: TypeErrorInfo[] = [];

    // Parse tsc output for story file errors only
    const lines = output.split('\n');
    for (const line of lines) {
      // Match lines like: src/components/Button.stories.ts(5,10): error TS2307: ...
      const match = line.match(/([^\s]+\.stories\.ts)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/);
      if (match) {
        errors.push({
          file: path.basename(match[1]),
          message: `${match[4]}: ${match[5]} (line ${match[2]})`,
        });
      }
    }

    return errors;
  }
}
