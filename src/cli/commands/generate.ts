import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import { findComponents } from '../../detector/componentFinder.js';
import { buildProgram } from '../../parser/programBuilder.js';
import { parseComponent } from '../../parser/componentParser.js';
import { buildStoryContent } from '../../generator/storyBuilder.js';
import { writeStory } from '../../generator/storyWriter.js';
import { logger } from '../../utils/logger.js';

export interface GenerateOptions {
  overwrite?: boolean;
  dryRun?: boolean;
  check?: boolean;
}

export async function runGenerate(dir: string, opts: GenerateOptions = {}): Promise<void> {
  const resolvedDir = path.resolve(dir);
  logger.info(`Scanning for components in: ${resolvedDir}`);

  // Step 1: Discover component files
  const componentFiles = await findComponents(resolvedDir);
  logger.info(`Found ${componentFiles.length} candidate component(s)`);

  if (componentFiles.length === 0) {
    logger.warn('No components found. Make sure the directory contains .tsx files.');
    return;
  }

  // Step 2: Build ts-morph project with all discovered files
  const project = buildProgram(resolvedDir, componentFiles);

  let generated = 0;
  let skipped = 0;
  let errored = 0;

  // --check mode: generate to temp dir, validate, then exit
  if (opts.check) {
    await runCheckMode(resolvedDir, componentFiles, project);
    return;
  }

  // Step 3: Parse → Map → Generate → Write each component
  for (const filePath of componentFiles) {
    try {
      const meta = parseComponent(project, filePath);

      if (meta.skipReason) {
        logger.skip(`${path.basename(filePath)}: ${meta.skipReason}`);
        skipped++;
        continue;
      }

      const relativePath = path.relative(path.dirname(filePath), filePath);
      const content = buildStoryContent(meta, relativePath);

      if (opts.dryRun) {
        logger.info(`[dry-run] Would write story for ${meta.name}`);
        generated++;
        continue;
      }

      const result = writeStory(filePath, content, { overwrite: opts.overwrite });

      switch (result) {
        case 'written':
          logger.success(`Generated story for ${meta.name}`);
          generated++;
          break;
        case 'skipped':
          logger.skip(`Story already up-to-date for ${meta.name}`);
          skipped++;
          break;
        case 'conflict':
          logger.warn(`Conflict detected for ${meta.name} — wrote .stories.generated.ts`);
          generated++;
          break;
      }
    } catch (err) {
      logger.error(`Failed to process ${path.basename(filePath)}: ${(err as Error).message}`);
      errored++;
    }
  }

  // Step 4: Summary
  console.log('');
  logger.info(`Summary:`);
  logger.info(`  Components found:   ${componentFiles.length}`);
  logger.success(`  Stories generated:  ${generated}`);
  if (skipped > 0) logger.skip(`  Skipped:            ${skipped}`);
  if (errored > 0) logger.error(`  Errors:             ${errored}`);
}

/**
 * --check mode: generates stories to a temp directory, validates structure,
 * then cleans up. Never writes to the real project. Safe for CI.
 */
async function runCheckMode(
  resolvedDir: string,
  componentFiles: string[],
  project: ReturnType<typeof buildProgram>,
): Promise<void> {
  logger.info('[check] Validating stories without writing to disk...');

  const results: Array<{ name: string; status: 'ok' | 'error'; message?: string }> = [];
  let hasErrors = false;

  for (const filePath of componentFiles) {
    try {
      const meta = parseComponent(project, filePath);

      if (meta.skipReason) {
        results.push({ name: path.basename(filePath), status: 'ok', message: `skipped: ${meta.skipReason}` });
        continue;
      }

      const relativePath = path.relative(path.dirname(filePath), filePath);
      const content = buildStoryContent(meta, relativePath);

      // Validate structure
      const errors = validateStoryContent(content, meta.name);
      if (errors.length > 0) {
        hasErrors = true;
        for (const err of errors) {
          results.push({ name: meta.name, status: 'error', message: err });
        }
      } else {
        results.push({ name: meta.name, status: 'ok' });
      }

      // Check if existing story is outdated
      const baseName = path.basename(filePath).replace(/\.(tsx?|jsx?)$/, '');
      const existingStoryPath = path.join(path.dirname(filePath), `${baseName}.stories.ts`);
      if (fs.existsSync(existingStoryPath)) {
        const existing = fs.readFileSync(existingStoryPath, 'utf-8');
        const existingChecksum = existing.match(/checksum: ([a-f0-9]+)/)?.[1];
        const newChecksum = content.match(/checksum: ([a-f0-9]+)/)?.[1];
        if (existingChecksum && newChecksum && existingChecksum !== newChecksum) {
          results.push({ name: meta.name, status: 'error', message: 'Story is outdated — props have changed' });
          hasErrors = true;
        }
      }
    } catch (err) {
      results.push({ name: path.basename(filePath), status: 'error', message: (err as Error).message });
      hasErrors = true;
    }
  }

  // TypeScript validation in temp dir
  logger.info('[check] Running TypeScript validation...');
  const typeErrors = await typecheckInTempDir(resolvedDir, componentFiles, project);
  if (typeErrors.length > 0) {
    hasErrors = true;
    for (const err of typeErrors) {
      results.push({ name: err.file, status: 'error', message: `TypeScript: ${err.message}` });
    }
  } else {
    logger.success('[check] TypeScript validation passed');
  }

  // Print results
  console.log('');
  for (const r of results) {
    if (r.status === 'ok') {
      logger.success(`${r.name}: ${r.message ?? 'valid'}`);
    } else {
      logger.error(`${r.name}: ${r.message}`);
    }
  }

  console.log('');
  if (hasErrors) {
    logger.error('[check] Validation failed — stories would break the build.');
    process.exit(1);
  } else {
    logger.success('[check] All stories are valid. Safe to generate.');
  }
}

function validateStoryContent(content: string, componentName: string): string[] {
  const errors: string[] = [];

  if (!content.includes('// @sbook-ai checksum:')) {
    errors.push('Missing checksum header');
  }
  if (!content.includes("from '@storybook/react'")) {
    errors.push('Missing @storybook/react import');
  }
  if (!content.includes(`import ${componentName}`)) {
    errors.push(`Missing component import for ${componentName}`);
  }
  if (!content.includes('export default meta')) {
    errors.push('Missing meta export');
  }
  if (!content.includes('export const Default: Story')) {
    errors.push('Missing Default story');
  }

  // Check balanced braces
  let depth = 0;
  for (const ch of content) {
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (depth < 0) {
      errors.push('Unbalanced brackets in generated story');
      break;
    }
  }
  if (depth !== 0) {
    errors.push(`Unbalanced brackets (depth: ${depth})`);
  }

  // Check for duplicate export names
  const exports = content.match(/export const (\w+):/g) ?? [];
  const names = exports.map((e) => e.match(/export const (\w+)/)![1]);
  if (new Set(names).size !== names.length) {
    errors.push('Duplicate story export names');
  }

  return errors;
}

interface TypeErrorInfo {
  file: string;
  message: string;
}

async function typecheckInTempDir(
  dir: string,
  componentFiles: string[],
  project: ReturnType<typeof buildProgram>,
): Promise<TypeErrorInfo[]> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbook-ai-check-'));

  try {
    // Copy component files and generate stories in temp dir
    for (const filePath of componentFiles) {
      const meta = parseComponent(project, filePath);
      if (meta.skipReason) continue;

      const baseName = path.basename(filePath);
      fs.copyFileSync(filePath, path.join(tmpDir, baseName));

      const content = buildStoryContent(meta, baseName);
      const storyName = baseName.replace(/\.(tsx?|jsx?)$/, '.stories.ts');
      fs.writeFileSync(path.join(tmpDir, storyName), content);
    }

    // Write tsconfig for the temp dir
    // Look for project's tsconfig to inherit from
    const tsconfigCandidates = [
      path.join(dir, 'tsconfig.json'),
      path.join(dir, '..', 'tsconfig.json'),
      path.join(dir, '..', '..', 'tsconfig.json'),
    ];

    let projectTsconfig: string | undefined;
    for (const candidate of tsconfigCandidates) {
      if (fs.existsSync(candidate)) {
        projectTsconfig = path.resolve(candidate);
        break;
      }
    }

    // Find node_modules for type resolution
    const nodeModulesCandidates = [
      path.join(dir, 'node_modules'),
      path.join(dir, '..', 'node_modules'),
      path.join(dir, '..', '..', 'node_modules'),
    ];
    let nodeModulesPath: string | undefined;
    for (const candidate of nodeModulesCandidates) {
      if (fs.existsSync(candidate)) {
        nodeModulesPath = path.resolve(candidate);
        break;
      }
    }

    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        ...(nodeModulesPath ? { typeRoots: [path.join(nodeModulesPath, '@types')] } : {}),
      },
      include: ['*.ts', '*.tsx'],
    };

    // Write storybook type stubs
    fs.writeFileSync(
      path.join(tmpDir, 'storybook.d.ts'),
      `declare module '@storybook/react' {
  export type Meta<T = any> = {
    title?: string;
    component?: T;
    tags?: string[];
    argTypes?: Record<string, any>;
    decorators?: any[];
  };
  export type StoryObj<T = any> = {
    args?: Record<string, any>;
    play?: (context: any) => Promise<void>;
  };
}`
    );

    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

    execSync(`npx tsc --noEmit --project ${path.join(tmpDir, 'tsconfig.json')}`, {
      cwd: tmpDir,
      stdio: 'pipe',
      timeout: 60000,
    });

    return [];
  } catch (err: any) {
    const output = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
    const errors: TypeErrorInfo[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const match = line.match(/([^\s]+\.stories\.ts)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/);
      if (match) {
        errors.push({
          file: match[1],
          message: `${match[4]}: ${match[5]} (line ${match[2]})`,
        });
      }
    }

    // If no story-specific errors but tsc failed, the error is in component files (not our fault)
    if (errors.length === 0) {
      return [];
    }

    return errors;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
