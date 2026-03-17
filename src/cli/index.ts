#!/usr/bin/env node
import { Command } from 'commander';
import { runGenerate } from './commands/generate.js';
import { runVerify } from './commands/verify.js';
import { runInit } from './commands/init.js';
import { runWatch } from './commands/watch.js';
import { runUpdate } from './commands/update.js';

const program = new Command();

program
  .name('storybook-gen')
  .description('Auto-generate Storybook stories from React/TypeScript components')
  .version('0.1.0');

program
  .command('generate [dir]')
  .description('Generate Storybook stories for components in a directory (defaults to current directory)')
  .option('--overwrite', 'Overwrite existing story files', false)
  .option('--dry-run', 'Preview what would be generated without writing files', false)
  .option('--check', 'Generate and verify stories without writing (CI-safe)', false)
  .action(async (dir: string | undefined, opts: { overwrite: boolean; dryRun: boolean; check: boolean }) => {
    await runGenerate(dir ?? '.', opts);
  });

program
  .command('verify [dir]')
  .description('Verify generated stories are in sync and valid (defaults to current directory)')
  .option('--typecheck', 'Also run TypeScript validation on generated stories', false)
  .action(async (dir: string | undefined, opts: { typecheck: boolean }) => {
    const exitCode = await runVerify(dir ?? '.', opts);
    process.exit(exitCode);
  });

program
  .command('init [dir]')
  .description('Add Windsurf Cascade skills to the current project')
  .option('--force', 'Overwrite existing skill files', false)
  .action(async (dir: string | undefined, opts: { force: boolean }) => {
    await runInit(dir ?? '.', opts);
  });

program
  .command('watch [dir]')
  .description('Watch a directory for component changes and auto-generate stories (defaults to current directory)')
  .option('--overwrite', 'Overwrite existing story files', false)
  .action(async (dir: string | undefined, opts: { overwrite: boolean }) => {
    await runWatch(dir ?? '.', opts);
  });

program
  .command('update')
  .description('Pull latest changes and rebuild storybook-gen')
  .action(async () => {
    await runUpdate();
  });

program.parse(process.argv);
