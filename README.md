# storybook-gen

Auto-generate Storybook stories from React/TypeScript components. Detects components, infers props from TypeScript types, and outputs ready-to-run `.stories.ts` files in CSF3 format.

## Quick Start

```bash
# Install globally from npm
npm install -g storybook-ai-generator

# Generate stories for any React project
cd ~/your-react-project
storybook-gen generate
```

Or clone and link locally for development:

```bash
git clone https://github.com/nngu3010/storybook-gen.git
cd storybook-gen
npm install && npm run build && npm link
```

## Commands

All commands default to the current directory when no `<dir>` is given.

### `generate [dir]` — Generate stories

```bash
storybook-gen generate                         # scan current directory
storybook-gen generate ./src/components        # scan a specific directory
storybook-gen generate --dry-run               # preview without writing files
storybook-gen generate --overwrite             # force overwrite existing stories
storybook-gen generate --check                 # CI-safe: validate without writing (exits 1 on failure)
```

### `verify [dir]` — Verify stories are in sync

```bash
storybook-gen verify                           # check stories match current props
storybook-gen verify --typecheck               # also typecheck with tsc
```

### `watch [dir]` — Watch mode

```bash
storybook-gen watch                            # watch current directory
storybook-gen watch ./src/components           # watch a specific directory
storybook-gen watch --overwrite                # overwrite stories on change
```

Watch mode:
- Generates a story when a new component file is added
- Regenerates a story when a component changes
- Deletes the story when a component is removed
- Press `Ctrl+C` to stop

### `init [dir]` — Add Windsurf Cascade skills

```bash
storybook-gen init                             # scaffold skills in current project
storybook-gen init --force                     # overwrite existing skill files
```

Writes three [Windsurf Cascade](https://docs.windsurf.com/windsurf/cascade/skills) skills into `.windsurf/skills/`:

| Skill | Trigger |
|---|---|
| `@storybook-generate` | user wants to generate / create / add stories |
| `@storybook-verify` | user wants to check / validate / audit stories |
| `@storybook-workflow` | user wants the full pipeline or to refresh all stories |

Cascade also auto-invokes these skills when your request matches their description.

### `update` — Update the tool

```bash
storybook-gen update
```

Pulls the latest changes from git and rebuilds. If the working directory has uncommitted changes, they are stashed and restored after the update. Falls back to a rebuild-only if no git remote is found.

---

## Workflows

### Full safe workflow

```bash
# 1. Check first (writes nothing)
storybook-gen generate --check

# 2. Generate (safe — never overwrites hand-edited files)
storybook-gen generate

# 3. Verify after
storybook-gen verify --typecheck

# 4. Build your app to make sure nothing broke
npm run build
```

### First-time setup

```bash
# 1. Generate stories
storybook-gen generate

# 2. Install Storybook (if not already installed)
npx storybook@latest init

# 3. Launch Storybook
npm run storybook
```

### After changing components

```bash
# 1. Verify what's outdated
storybook-gen verify

# 2. Regenerate (safe — never overwrites hand-edited stories)
storybook-gen generate

# 3. Verify everything is in sync
storybook-gen verify --typecheck
```

### Development (watch mode)

```bash
# Keep stories in sync as you build components
storybook-gen watch
```

### CI pipeline

```yaml
# .github/workflows/storybook.yml
name: Storybook Stories Check
on: [pull_request]

jobs:
  verify-stories:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Install storybook-gen
        run: npm install -g storybook-ai-generator

      - name: Check stories are valid and in sync
        run: storybook-gen generate --check

      - name: Verify stories
        run: storybook-gen verify --typecheck

      - name: Build Storybook
        run: npm run build-storybook
```

### Pre-commit hook (with husky)

```bash
# .husky/pre-commit
storybook-gen verify
```

---

## Safety Guarantees

| Concern | How it's handled |
|---|---|
| Overwrites hand-edited stories | Never. Writes `.stories.generated.ts` on conflict |
| Breaks the build | `--check` validates in a temp dir first |
| Outdated stories | `verify` detects prop drift via checksum |
| Invalid TypeScript | `--typecheck` runs `tsc --noEmit` on generated files |
| Duplicate exports | Structural validation catches these |
| Re-running is destructive | Idempotent — skips unchanged components |

---

## How It Works

### 1. Detects components

Globs `**/*.tsx`, applies heuristics (default export, JSX return, capital letter naming). Skips test files, story files, barrel re-exports, and HOCs.

### 2. Extracts props

Uses `ts-morph` to parse TypeScript types. Handles:
- `React.FC<Props>` unwrapping
- Intersection types (merges all properties, filters `node_modules` props)
- Default values from destructuring
- JSDoc comments and `@deprecated` tags

### 3. Maps types to controls

| TypeScript type | Storybook control |
|---|---|
| `string` | `text` |
| `number` | `number` |
| `boolean` | `boolean` |
| `'a' \| 'b' \| 'c'` | `select` with options |
| `1 \| 2 \| 3` | `select` with options |
| `() => void` | `action` |
| `ReactNode` | excluded from panel |
| arrays, objects, `CSSProperties` | `object` |

### 4. Generates variant stories

String union props (like `variant: 'primary' | 'secondary' | 'danger'`) automatically get a named story per value. Priority order: `variant > type > kind > size > color > theme`.

### 5. Collision protection

Every generated file has a checksum header:
```
// @storybook-gen checksum: a49a938c05dd generated: 2026-03-17
```

On re-run:
- **Checksum matches** → skip (no change needed)
- **Checksum differs, no `--overwrite`** → write `.stories.generated.ts` alongside
- **Checksum differs, `--overwrite`** → replace the file

---

## Example Output

Given `Button.tsx`:
```tsx
interface ButtonProps {
  /** The text label */
  label: string;
  /** Visual style variant */
  variant?: 'primary' | 'secondary' | 'danger';
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Click handler */
  onClick?: () => void;
}

export default function Button({ label, variant = 'primary', disabled = false, onClick }: ButtonProps) { ... }
```

Generates `Button.stories.ts`:
```ts
// @storybook-gen checksum: a49a938c05dd generated: 2026-03-17
// AUTO-GENERATED — do not edit this file manually.

import type { Meta, StoryObj } from '@storybook/react';
import Button from './Button';

const meta: Meta<typeof Button> = {
  title: 'Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    label:    { control: 'text', description: "The text label" },
    variant:  { control: 'select', options: ['primary', 'secondary', 'danger'], description: "Visual style variant" },
    disabled: { control: 'boolean', description: "Whether the button is disabled" },
    onClick:  { action: 'onClick' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default:   Story = { args: { label: "", variant: "primary", disabled: false } };
export const Primary:   Story = { args: { label: "", disabled: false, variant: 'primary' } };
export const Secondary: Story = { args: { label: "", disabled: false, variant: 'secondary' } };
export const Danger:    Story = { args: { label: "", disabled: false, variant: 'danger' } };
```

---

## Component Requirements for Best Results

storybook-gen works best when components:
- Have a **default export** (function or arrow function)
- Have **typed props** with a TypeScript interface or type
- Use **JSDoc comments** on props for auto-generated descriptions
- Use **string literal unions** for variant props (e.g., `'primary' | 'secondary'`)
- Use **destructuring with defaults** for default prop values

---

## Development

```bash
npm test           # watch mode
npm run test:run   # single run (104 tests)
npm run build      # compile TypeScript
npm run dev        # build in watch mode
```

## Test Suite

| File | Tests | Coverage |
|---|---|---|
| `typeMapper.test.ts` | 43 | Every type→control mapping, nullable stripping, defaults |
| `heuristics.test.ts` | 20 | Component detection accuracy |
| `variantDetector.test.ts` | 20 | Variant prop priority and story generation |
| `integration.test.ts` | 15 | Full pipeline: detect→parse→generate→write |
| `e2e.test.ts` | 6 | End-to-end generation + TypeScript validation |

## Project Structure

```
src/
  cli/
    index.ts                  CLI entry point
    commands/
      generate.ts             Generate + --check mode
      verify.ts               Verify stories are in sync
      watch.ts                Watch mode (chokidar)
      init.ts                 Windsurf Cascade skill scaffolding
      update.ts               Self-update via git pull + rebuild
  detector/
    componentFinder.ts        Glob + heuristic filtering
    heuristics.ts             Component confidence scoring
  parser/
    programBuilder.ts         ts-morph Project setup
    componentParser.ts        AST prop extraction
  mapper/
    typeMapper.ts             TS type → Storybook control
    variantDetector.ts        String union → variant stories
  generator/
    storyBuilder.ts           CSF3 story content builder
    storyWriter.ts            File writer with collision protection
  utils/
    logger.ts                 Chalk-based logger
tests/
  fixtures/                   Sample React components
  typeMapper.test.ts          43 unit tests
  heuristics.test.ts          20 unit tests
  variantDetector.test.ts     20 unit tests
  integration.test.ts         15 integration tests
  e2e.test.ts                 6 end-to-end tests
```
