import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';

export interface InitOptions {
  force?: boolean;
}

interface SkillDefinition {
  dir: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Skill content
// ---------------------------------------------------------------------------

const SKILLS: Record<string, SkillDefinition> = {
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
| ✓ in sync | Story matches component props | Nothing to do |
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

Run the complete storybook-gen workflow. Always follows the safe sequence: check → generate → verify → build.

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
// Main
// ---------------------------------------------------------------------------

export async function runInit(targetDir: string, opts: InitOptions = {}): Promise<void> {
  const resolvedDir = path.resolve(targetDir);

  if (!fs.existsSync(resolvedDir)) {
    logger.error(`Directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  logger.info(`Initialising storybook-gen in: ${resolvedDir}`);

  const skillsRoot = path.join(resolvedDir, '.windsurf', 'skills');
  let created = 0;
  let skipped = 0;

  for (const [skillName, skill] of Object.entries(SKILLS)) {
    const skillDir = path.join(skillsRoot, skill.dir);
    const skillFile = path.join(skillDir, 'SKILL.md');

    if (fs.existsSync(skillFile) && !opts.force) {
      logger.skip(`Skill already exists: ${skillName}`);
      skipped++;
      continue;
    }

    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillFile, skill.content, 'utf-8');
    logger.success(`Created skill: .windsurf/skills/${skill.dir}/SKILL.md`);
    created++;
  }

  console.log('');

  if (created > 0) {
    logger.success(`Added ${created} Windsurf skill(s) to your project.`);
    console.log('');
    logger.info('Skills available in Windsurf Cascade:');
    logger.info('  @storybook-generate  — generate stories for components');
    logger.info('  @storybook-verify    — verify stories are in sync');
    logger.info('  @storybook-workflow  — run the full safe workflow');
    console.log('');
    logger.info('Cascade will also auto-invoke these skills when relevant.');
  }

  if (skipped > 0 && created === 0) {
    logger.info(`All skills already exist. Use --force to overwrite.`);
  }
}
