#!/usr/bin/env node
import { Command } from 'commander';
import { runGenerate } from './commands/generate.js';
import { runVerify } from './commands/verify.js';
import { runInit } from './commands/init.js';
import { runWatch } from './commands/watch.js';
import { runUpdate } from './commands/update.js';
import { runServe } from './commands/serve.js';
import { runDecorators } from './commands/decorators.js';
import { runSetup } from './commands/setup.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

const program = new Command();

program
  .name('sbook-ai')
  .description('Auto-generate Storybook stories from React/TypeScript components')
  .version(version);

program
  .command('generate [dir]')
  .description('Generate Storybook stories for components in a directory (defaults to current directory)')
  .option('--overwrite', 'Overwrite existing story files', false)
  .option('--dry-run', 'Preview what would be generated without writing files', false)
  .option('--check', 'Generate and verify stories without writing (CI-safe)', false)
  .option('--ai', 'Use Claude AI to generate realistic, semantic arg values', false)
  .option('--output-dir <path>', 'Write stories to a centralized directory mirroring source structure')
  .action(async (dir: string | undefined, opts: { overwrite: boolean; dryRun: boolean; check: boolean; ai: boolean; outputDir?: string }) => {
    await runGenerate(dir ?? '.', opts);
  });

program
  .command('verify [dir]')
  .description('Verify generated stories are in sync and valid (defaults to current directory)')
  .option('--typecheck', 'Also run TypeScript validation on generated stories', false)
  .option('--output-dir <path>', 'Look for stories in a centralized directory mirroring source structure')
  .action(async (dir: string | undefined, opts: { typecheck: boolean; outputDir?: string }) => {
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
  .option('--output-dir <path>', 'Write stories to a centralized directory mirroring source structure')
  .action(async (dir: string | undefined, opts: { overwrite: boolean; outputDir?: string }) => {
    await runWatch(dir ?? '.', opts);
  });

program
  .command('decorators [dir]')
  .description('Detect state management libraries and generate .storybook/preview.ts with provider decorators')
  .option('--force', 'Overwrite existing preview.ts and companion files', false)
  .action(async (dir: string | undefined, opts: { force: boolean }) => {
    await runDecorators(dir ?? '.', opts);
  });

program
  .command('setup [dir]')
  .description('Configure MCP server and/or Anthropic API key for AI-powered story generation')
  .option('--mcp', 'Set up MCP server config (non-interactive)')
  .option('--api-key', 'Set up Anthropic API key (interactive)')
  .action(async (dir: string | undefined, opts: { mcp?: boolean; apiKey?: boolean }) => {
    await runSetup(dir ?? '.', opts);
  });

program
  .command('update')
  .description('Check for updates and install the latest version')
  .action(async () => {
    await runUpdate();
  });

program
  .command('serve')
  .description('Start an MCP server exposing component metadata and story generation tools')
  .action(async () => {
    await runServe();
  });

program.parse(process.argv);
