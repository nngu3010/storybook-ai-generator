import fs from 'fs';
import path from 'path';
import readline from 'readline';
import chalk from 'chalk';
import { logger } from '../../utils/logger.js';

export interface SetupOptions {
  mcp?: boolean;
  apiKey?: boolean;
}

// ---------------------------------------------------------------------------
// Interactive prompt helper (no external dependency)
// ---------------------------------------------------------------------------

function createPrompt(): { ask(question: string): Promise<string>; close(): void } {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask(question: string): Promise<string> {
      return new Promise((resolve) => rl.question(question, resolve));
    },
    close() { rl.close(); },
  };
}

// ---------------------------------------------------------------------------
// IDE / Agent detection
// ---------------------------------------------------------------------------

interface IdeConfig {
  name: string;
  slug: string;
  detected: boolean;
  configPath: string;           // relative to project root
  configureFunc: (dir: string) => void;
}

function detectIdes(dir: string): IdeConfig[] {
  return [
    {
      name: 'Claude Code',
      slug: 'claude-code',
      detected: fs.existsSync(path.join(dir, '.claude')) || fs.existsSync(path.join(dir, 'CLAUDE.md')),
      configPath: '.mcp.json',
      configureFunc: (d) => configureMcpJson(d, '.mcp.json'),
    },
    {
      name: 'Cursor',
      slug: 'cursor',
      detected: fs.existsSync(path.join(dir, '.cursor')) || fs.existsSync(path.join(dir, '.cursorrules')),
      configPath: '.cursor/mcp.json',
      configureFunc: (d) => configureMcpJson(d, '.cursor/mcp.json'),
    },
    {
      name: 'VS Code (Copilot)',
      slug: 'vscode',
      detected: fs.existsSync(path.join(dir, '.vscode')),
      configPath: '.vscode/mcp.json',
      configureFunc: (d) => configureMcpJson(d, '.vscode/mcp.json'),
    },
    {
      name: 'Windsurf',
      slug: 'windsurf',
      detected: fs.existsSync(path.join(dir, '.windsurf')) || fs.existsSync(path.join(dir, '.windsurfrules')),
      configPath: '.windsurf/mcp.json',
      configureFunc: (d) => configureMcpJson(d, '.windsurf/mcp.json'),
    },
  ];
}

// ---------------------------------------------------------------------------
// MCP config writers
// ---------------------------------------------------------------------------

function configureMcpJson(dir: string, relativePath: string): void {
  const fullPath = path.join(dir, relativePath);
  const parentDir = path.dirname(fullPath);

  const mcpEntry = {
    command: 'npx',
    args: ['sbook-ai', 'serve'],
  };

  let config: Record<string, unknown> = {};

  if (fs.existsSync(fullPath)) {
    try {
      config = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    } catch {
      // Corrupted file — start fresh
    }
  }

  // Ensure mcpServers key exists
  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    config.mcpServers = {};
  }

  const servers = config.mcpServers as Record<string, unknown>;

  if (servers['sbook-ai']) {
    logger.skip(`MCP server already configured in ${relativePath}`);
    return;
  }

  servers['sbook-ai'] = mcpEntry;

  fs.mkdirSync(parentDir, { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  logger.success(`Added MCP server to ${relativePath}`);
}

// ---------------------------------------------------------------------------
// API key setup
// ---------------------------------------------------------------------------

function setupApiKey(dir: string, key: string): void {
  const envPath = path.join(dir, '.env');
  const envLocalPath = path.join(dir, '.env.local');

  // Prefer .env.local if it exists, else .env
  const targetPath = fs.existsSync(envLocalPath) ? envLocalPath : envPath;
  const targetName = path.basename(targetPath);

  let content = '';
  if (fs.existsSync(targetPath)) {
    content = fs.readFileSync(targetPath, 'utf-8');
  }

  // Check if already set
  if (/^ANTHROPIC_API_KEY=/m.test(content)) {
    // Replace existing
    content = content.replace(/^ANTHROPIC_API_KEY=.*$/m, `ANTHROPIC_API_KEY=${key}`);
    logger.success(`Updated ANTHROPIC_API_KEY in ${targetName}`);
  } else {
    // Append
    const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    content += `${separator}ANTHROPIC_API_KEY=${key}\n`;
    logger.success(`Added ANTHROPIC_API_KEY to ${targetName}`);
  }

  fs.writeFileSync(targetPath, content, 'utf-8');
  ensureGitignore(dir, targetName);
}

function ensureGitignore(dir: string, envFile: string): void {
  const gitignorePath = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return;

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  if (content.includes(envFile) || content.includes('.env*') || content.includes('.env')) return;

  // Warn if .env might not be gitignored
  logger.warn(`Make sure ${envFile} is in your .gitignore to avoid leaking your API key.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runSetup(dir: string, opts: SetupOptions = {}): Promise<void> {
  const resolvedDir = path.resolve(dir);

  if (!fs.existsSync(resolvedDir)) {
    logger.error(`Directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  console.log('');
  console.log(chalk.bold('  sbook-ai setup'));
  console.log(chalk.gray('  Configure AI-powered story generation for your project'));
  console.log('');

  const prompt = createPrompt();
  const skipPrompts = opts.mcp !== undefined || opts.apiKey !== undefined;

  try {
    // -----------------------------------------------------------------------
    // Step 1: MCP Server Setup
    // -----------------------------------------------------------------------
    let setupMcp = opts.mcp ?? false;

    if (!skipPrompts) {
      const answer = await prompt.ask(
        `${chalk.cyan('?')} Set up MCP server for your AI assistant? ${chalk.gray('(y/N)')} `,
      );
      setupMcp = /^y(es)?$/i.test(answer.trim());
    }

    if (setupMcp) {
      const ides = detectIdes(resolvedDir);
      const detected = ides.filter((i) => i.detected);

      if (detected.length > 0) {
        console.log('');
        logger.info(`Detected: ${detected.map((i) => chalk.bold(i.name)).join(', ')}`);

        for (const ide of detected) {
          if (skipPrompts) {
            ide.configureFunc(resolvedDir);
          } else {
            const answer = await prompt.ask(
              `${chalk.cyan('?')} Configure MCP for ${chalk.bold(ide.name)}? ${chalk.gray('(Y/n)')} `,
            );
            if (!/^n(o)?$/i.test(answer.trim())) {
              ide.configureFunc(resolvedDir);
            }
          }
        }

        // Offer to configure non-detected IDEs
        const notDetected = ides.filter((i) => !i.detected);
        if (notDetected.length > 0 && !skipPrompts) {
          const answer = await prompt.ask(
            `${chalk.cyan('?')} Also configure for other editors? ${chalk.gray('(y/N)')} `,
          );
          if (/^y(es)?$/i.test(answer.trim())) {
            for (const ide of notDetected) {
              const ans = await prompt.ask(
                `${chalk.cyan('?')}   ${ide.name}? ${chalk.gray('(y/N)')} `,
              );
              if (/^y(es)?$/i.test(ans.trim())) {
                ide.configureFunc(resolvedDir);
              }
            }
          }
        }
      } else {
        logger.info('No IDE/agent config detected. Setting up for all supported editors.');
        for (const ide of ides) {
          if (skipPrompts) {
            ide.configureFunc(resolvedDir);
          } else {
            const answer = await prompt.ask(
              `${chalk.cyan('?')} Configure MCP for ${chalk.bold(ide.name)}? ${chalk.gray('(y/N)')} `,
            );
            if (/^y(es)?$/i.test(answer.trim())) {
              ide.configureFunc(resolvedDir);
            }
          }
        }
      }
      console.log('');
    }

    // -----------------------------------------------------------------------
    // Step 2: API Key Setup
    // -----------------------------------------------------------------------
    let setupKey = opts.apiKey ?? false;

    if (!skipPrompts) {
      console.log(chalk.gray('  The --ai flag works without an API key using smart heuristics.'));
      console.log(chalk.gray('  Adding an Anthropic API key enables Claude-powered arg generation'));
      console.log(chalk.gray('  for more realistic, context-aware story values.'));
      console.log('');
      const answer = await prompt.ask(
        `${chalk.cyan('?')} Set up Anthropic API key? ${chalk.gray('(y/N)')} `,
      );
      setupKey = /^y(es)?$/i.test(answer.trim());
    }

    if (setupKey) {
      const existingKey = process.env.ANTHROPIC_API_KEY;
      if (existingKey && !skipPrompts) {
        logger.info('ANTHROPIC_API_KEY already set in environment.');
        const answer = await prompt.ask(
          `${chalk.cyan('?')} Replace it in .env? ${chalk.gray('(y/N)')} `,
        );
        if (!/^y(es)?$/i.test(answer.trim())) {
          logger.skip('Keeping existing API key.');
          setupKey = false;
        }
      }

      if (setupKey) {
        const key = await prompt.ask(
          `${chalk.cyan('?')} Anthropic API key ${chalk.gray('(sk-ant-...)')} : `,
        );
        const trimmed = key.trim();
        if (trimmed.length === 0) {
          logger.skip('No key provided. Skipping.');
        } else if (!trimmed.startsWith('sk-ant-')) {
          logger.warn('Key does not start with "sk-ant-". Saving anyway.');
          setupApiKey(resolvedDir, trimmed);
        } else {
          setupApiKey(resolvedDir, trimmed);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('');
    console.log(chalk.bold('  Setup complete!'));
    console.log('');
    console.log(chalk.gray('  Quick start:'));
    console.log(`    ${chalk.cyan('npx sbook-ai generate src --ai')}    Generate stories with smart args`);
    console.log(`    ${chalk.cyan('npx sbook-ai verify src')}           Check stories are in sync`);
    console.log('');
    if (setupMcp) {
      console.log(chalk.gray('  MCP tools available to your AI assistant:'));
      console.log(`    ${chalk.cyan('list_components')}     Discover components and props`);
      console.log(`    ${chalk.cyan('get_component')}       Full metadata with hints and argTypes`);
      console.log(`    ${chalk.cyan('suggest_args')}        Get heuristic-generated arg values`);
      console.log(`    ${chalk.cyan('scan_project_context')} Find usages, mock data, design tokens`);
      console.log(`    ${chalk.cyan('generate_stories')}    Generate stories with custom args`);
      console.log(`    ${chalk.cyan('check_stories')}       Verify stories are in sync`);
      console.log('');
    }
  } finally {
    prompt.close();
  }
}
