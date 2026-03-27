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
      configureFunc: (d) => { configureMcpJson(d, '.mcp.json'); installClaudeCommands(d); },
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
      configureFunc: (d) => { configureMcpJson(d, '.windsurf/mcp.json'); installWindsurfSkills(d); },
    },
  ];
}

// ---------------------------------------------------------------------------
// Claude Code slash commands
// ---------------------------------------------------------------------------

const CLAUDE_COMMANDS: Record<string, string> = {
  'storybook.md': `# Generate and manage Storybook stories

You are the storybook-gen assistant. You help generate, verify, and manage Storybook stories for React/TypeScript components.

## When the user says \`/storybook\`, follow this workflow:

### Step 1: Detect the project

Find the components directory:
- Check \`./src/components/\`
- Check \`./src/\`
- Check \`./components/\`
- If unsure, ask the user which directory contains their components.

### Step 2: Check current state

Use \`check_stories\` to see which stories exist, are outdated, or are missing.

### Step 3: Generate stories (MCP-first workflow)

For components that need stories, use the full MCP workflow — this produces the best results with no API key required:

1. **\`list_components\`** — find all components
2. For each component needing stories:
   a. **\`get_component\`** — get full prop metadata
   b. **\`get_type_definition\`** — for every complex prop type (interfaces, objects, arrays of objects), resolve the full type tree. This is the key step — without it, complex props get empty objects.
   c. **\`find_usage_examples\`** — see how the component is actually used with real prop values
   d. **\`get_mock_fixtures\`** — find existing test data to reuse
   e. Analyze all context and craft complete, type-correct args
   f. **\`generate_stories\`** — generate with your custom args
   g. **\`validate_story\`** — check the story compiles correctly
   h. If errors: read the error, fix the args, regenerate (max 3 retries)
3. **\`check_stories\`** — confirm everything is in sync

### Step 4: Report results

Tell the user:
- How many components found, how many stories generated
- Any validation errors and whether they were auto-fixed
- If stories have conflicts (\`.stories.generated.ts\` files), explain and let the user decide

## CLI Fallback

If MCP tools are not available, fall back to the CLI:

\`\`\`bash
npx sbook-ai verify <dir>
npx sbook-ai generate <dir>
npx sbook-ai generate <dir> --check
npx sbook-ai generate <dir> --dry-run
npx sbook-ai generate <dir> --overwrite
\`\`\`

## Safety Rules

- NEVER use \`--overwrite\` or \`overwrite: true\` unless the user explicitly asks
- Always validate stories after generating
- If \`check_stories\` reports outdated stories, explain what changed before regenerating
- After generating, remind the user to review the generated files

## Component Requirements for Best Results

Remind users that storybook-gen works best when components:
- Have a **default export** (function or arrow function)
- Have **typed props** with a TypeScript interface or type
- Use **JSDoc comments** on props for auto-generated descriptions
- Use **string literal unions** for variant props (e.g., \`'primary' | 'secondary'\`)
`,

  'generate-stories.md': `# Generate Storybook Stories (MCP-First)

You are generating Storybook stories using MCP tools. No API key is needed — you are the AI. The MCP tools provide structured data and mechanical actions; you provide the reasoning.

## Workflow

### 1. Discover components

Call \`list_components\` with the project's component directory to find all React/TypeScript components.

If the user specified a component name, find it in the results. If they said "all" or gave a directory, process all components.

### 2. For each component, gather context

Call these tools to understand the component deeply:

**a. \`get_component\`** — Get full prop metadata: types, required/optional, defaults, JSDoc, variants.

**b. \`get_type_definition\`** — For EVERY prop with a complex type (interface, object, array of objects — anything that isn't string/number/boolean/union), resolve the full type tree. This is critical. Without it, you'll generate \`{}\` for complex props and the story will crash.

Example: if a prop is \`cartData: Cart\`, call \`get_type_definition\` with \`type: "Cart"\` to see:
\`\`\`
Cart -> id: string, items: CartItem[], summary: CartSummary
CartItem -> product: Product, quantity: number
Product -> id: string, name: string, price: number
\`\`\`

**c. \`find_usage_examples\`** — See how the component is actually used in production code. Prefer these real values over invented ones.

**d. \`get_mock_fixtures\`** — Check if the project has existing mock/fixture data you can reuse.

### 3. Craft args

Using all the context above, generate complete, type-correct args:

- **Default story**: Happy path with all required props filled. Use realistic data from usage examples and fixtures when available.
- **Variant stories**: If the component has a variant prop (e.g., \`variant: 'primary' | 'secondary'\`), create one story per variant value.
- **Complex props**: Build the full nested object matching the resolved type definition. Every required field must be present.
- **Arrays**: Include 2-3 items with varied but realistic data.
- **Consistency**: If a prop is \`price\` and another is \`originalPrice\`, ensure \`originalPrice > price\`.

### 4. Generate stories

Call \`generate_stories\` with your crafted args:
\`\`\`json
{
  "dir": "./src/components",
  "components": ["CartFooter"],
  "args": {
    "CartFooter": {
      "Default": {
        "cartData": { "id": "cart-001", "items": [...], "summary": {...} },
        "onCheckout": null
      },
      "variants": {}
    }
  }
}
\`\`\`

### 5. Validate

Call \`validate_story\` for each generated story. This checks TypeScript compilation.

### 6. Fix errors (if any)

If validation fails:
1. Read the error message
2. Call \`get_type_definition\` for the failing type
3. Identify the missing/wrong field
4. Call \`generate_stories\` again with corrected args
5. Re-validate

Retry up to 3 times. If still failing, report the error to the user.

### 7. Report results

Tell the user:
- Which components got stories generated
- How many stories per component (Default + variants)
- Any validation errors that couldn't be auto-fixed

## Tips

- For simple components (all primitive props), you can skip \`get_type_definition\` and just use \`suggest_args\` as a quick shortcut.
- Skip function/callback props (onClick, onChange) — they become Storybook actions automatically.
- Skip \`ReactNode\` props like \`children\` — they don't need controls.
- If \`find_usage_examples\` returns real values, prefer those over generic placeholders.
`,

  'fix-story.md': `# Fix a Broken Storybook Story

You are diagnosing and fixing a Storybook story that crashes or has TypeScript errors.

## Workflow

### 1. Identify the problem

Call \`validate_story\` with the component name to get the specific error:
- TypeScript compilation errors with line numbers
- Missing type information
- Incorrect prop shapes

### 2. Understand the component

Call \`get_component\` to see the full prop metadata — types, required/optional, defaults.

### 3. Resolve complex types

For each prop mentioned in the error, call \`get_type_definition\` to see the full interface tree. The most common failure is a complex prop (like \`cartData: Cart\`) receiving \`{}\` or a flat string instead of a properly-shaped nested object.

### 4. Check for real data

Call \`get_mock_fixtures\` to see if the project has existing mock data for the failing types. If fixtures exist, reuse them — they're already known to work.

### 5. Fix and regenerate

Call \`generate_stories\` with corrected args that match the resolved type definitions. Make sure every required field in every nested object is present.

### 6. Verify the fix

Call \`validate_story\` again. If it passes, report success. If it fails with a new error, repeat from step 3.

## Common Fixes

- **"Cannot read properties of undefined"** — A nested object or array is missing. Resolve the type and add the missing data.
- **"Type '{}' is not assignable to type 'X'"** — The object is empty. Fill in all required fields from the resolved type.
- **"Property 'X' is missing"** — A required field wasn't included. Add it.
- **Duplicate export names** — Two stories have the same name. This is a tool bug — report it.
`,
};

// ---------------------------------------------------------------------------
// Windsurf Cascade skills
// ---------------------------------------------------------------------------

const WINDSURF_SKILLS: Record<string, { dir: string; content: string }> = {
  'storybook-generate': {
    dir: 'storybook-generate',
    content: `---
name: storybook-generate
description: Generate Storybook stories for React/TypeScript components using storybook-gen. Use when the user wants to create, generate, add, or scaffold Storybook stories.
---

# storybook-generate

Generate Storybook stories for React/TypeScript components using the \`storybook-gen\` CLI.

## How to use this skill

### Step 1 — Find the components directory

Look for components in this order:
- \`./src/components/\`
- \`./src/\`
- \`./components/\`

If unsure, ask the user.

### Step 2 — Always check first (writes nothing)

\`\`\`bash
storybook-gen generate <dir> --check
\`\`\`

If \`--check\` fails, report the errors and stop. Do not generate until check passes.

### Step 3 — Generate

\`\`\`bash
storybook-gen generate <dir>
\`\`\`

This is safe — it never overwrites hand-edited story files. If a conflict is detected it writes a \`.stories.generated.ts\` file alongside the original.

### Step 4 — Confirm

Run verify to confirm everything is in sync:

\`\`\`bash
storybook-gen verify <dir>
\`\`\`

## Flags

| Flag | When to use |
|---|---|
| \`--dry-run\` | Preview what would be generated without writing |
| \`--check\` | Validate in a temp dir — CI-safe, writes nothing |
| \`--overwrite\` | Force replace existing stories — only use if user explicitly asks |

## Safety rules

- ALWAYS run \`--check\` before generating in an unfamiliar project
- NEVER use \`--overwrite\` unless the user explicitly requests it
- If conflicts appear (\`.stories.generated.ts\`), explain them to the user and let them decide

## What makes a good component for generation

Remind the user that storybook-gen works best when components:
- Have a **default export**
- Have **typed props** (TypeScript interface or type)
- Use **JSDoc comments** on props for auto-generated descriptions
- Use **string literal unions** for variant props (e.g., \`'primary' | 'secondary'\`)
- Use **destructured defaults** for default prop values
`,
  },

  'storybook-verify': {
    dir: 'storybook-verify',
    content: `---
name: storybook-verify
description: Verify that Storybook stories are in sync with their React components using storybook-gen. Use when the user wants to check, validate, or audit stories.
---

# storybook-verify

Verify that generated Storybook stories match the current state of their components.

## How to use this skill

### Basic verify

\`\`\`bash
storybook-gen verify <dir>
\`\`\`

### With TypeScript validation

\`\`\`bash
storybook-gen verify <dir> --typecheck
\`\`\`

Runs \`tsc --noEmit\` on generated stories in addition to checksum checks.

## Interpreting results

| Status | Meaning | Action |
|---|---|---|
| in sync | Story matches component props | Nothing to do |
| outdated | Props changed since story was generated | Run \`storybook-gen generate <dir>\` |
| missing | No story file exists | Run \`storybook-gen generate <dir>\` |
| type-error | Story has TypeScript errors | Investigate or regenerate with \`--overwrite\` |

## When stories are outdated

Tell the user which components changed, then offer to regenerate:

\`\`\`bash
storybook-gen generate <dir>
\`\`\`

This is safe — it writes \`.stories.generated.ts\` on conflict rather than overwriting.

## CI usage

Suggest adding to CI pipeline:

\`\`\`yaml
- run: storybook-gen generate ./src/components --check
- run: storybook-gen verify ./src/components --typecheck
\`\`\`
`,
  },

  'storybook-workflow': {
    dir: 'storybook-workflow',
    content: `---
name: storybook-workflow
description: Run the full safe storybook-gen workflow — check, generate, verify, and build. Use when the user wants to update or refresh all stories, or run the complete storybook pipeline.
---

# storybook-workflow

Run the complete storybook-gen workflow. Always follows the safe sequence: check -> generate -> verify -> build.

## Full workflow

\`\`\`bash
# 1. Check first (writes nothing)
storybook-gen generate <dir> --check

# 2. Generate (safe — never overwrites hand-edited files)
storybook-gen generate <dir>

# 3. Verify after
storybook-gen verify <dir> --typecheck

# 4. Build the app to confirm nothing broke
npm run build
\`\`\`

## How to run this skill

### Step 1 — Detect the project

Find the components directory:
- \`./src/components/\`
- \`./src/\`
- \`./components/\`

Ask the user if unclear.

### Step 2 — Check (dry validation)

\`\`\`bash
storybook-gen generate <dir> --check
\`\`\`

If check fails, report all errors and stop. Fix component issues before proceeding.

### Step 3 — Generate

\`\`\`bash
storybook-gen generate <dir>
\`\`\`

Report the summary: how many generated, skipped, or conflicted.

### Step 4 — Verify with typecheck

\`\`\`bash
storybook-gen verify <dir> --typecheck
\`\`\`

If outdated stories are found after generate, it means a conflict occurred — explain the \`.stories.generated.ts\` files to the user.

### Step 5 — Build

\`\`\`bash
npm run build
\`\`\`

Confirm the app still compiles with the new story files present.

## Safety rules

- Never skip the \`--check\` step
- Never use \`--overwrite\` without explicit user confirmation
- If any step fails, stop and report — do not proceed to the next step
- After the workflow completes, summarise what changed
`,
  },
};

// ---------------------------------------------------------------------------
// Editor-specific workflow installers
// ---------------------------------------------------------------------------

function installClaudeCommands(dir: string): void {
  const commandsDir = path.join(dir, '.claude', 'commands');
  let created = 0;

  for (const [filename, content] of Object.entries(CLAUDE_COMMANDS)) {
    const filePath = path.join(commandsDir, filename);

    if (fs.existsSync(filePath)) {
      logger.skip(`Command already exists: .claude/commands/${filename}`);
      continue;
    }

    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    logger.success(`Added command: .claude/commands/${filename}`);
    created++;
  }

  if (created > 0) {
    logger.info('  Slash commands available: /storybook, /generate-stories, /fix-story');
  }
}

function installWindsurfSkills(dir: string): void {
  const skillsRoot = path.join(dir, '.windsurf', 'skills');
  let created = 0;

  for (const [skillName, skill] of Object.entries(WINDSURF_SKILLS)) {
    const skillDir = path.join(skillsRoot, skill.dir);
    const skillFile = path.join(skillDir, 'SKILL.md');

    if (fs.existsSync(skillFile)) {
      logger.skip(`Skill already exists: ${skillName}`);
      continue;
    }

    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillFile, skill.content, 'utf-8');
    logger.success(`Added skill: .windsurf/skills/${skill.dir}/SKILL.md`);
    created++;
  }

  if (created > 0) {
    logger.info('  Skills available: @storybook-generate, @storybook-verify, @storybook-workflow');
  }
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
      console.log(chalk.gray('  Editor workflows installed (if applicable):'));
      console.log(`    ${chalk.cyan('Claude Code')}   /storybook, /generate-stories, /fix-story`);
      console.log(`    ${chalk.cyan('Windsurf')}      @storybook-generate, @storybook-verify, @storybook-workflow`);
      console.log('');
    }
  } finally {
    prompt.close();
  }
}
