# sbook-ai

**AI-native Storybook story generation for React/TypeScript components.**

No API key needed. Your editor's AI does the thinking. The tool does the work.

```bash
npx sbook-ai setup --mcp    # connect to your AI editor
# Then in Cursor/Claude Code/Windsurf: "Generate stories for my components"
```

> Works with Cursor, Claude Code, Windsurf, VS Code Copilot — any editor with MCP support.

---

## Why sbook-ai?

Writing Storybook stories by hand is tedious. Keeping them in sync with component changes is worse. `sbook-ai` reads your TypeScript types, understands your props, and generates production-ready CSF3 stories automatically.

- **No API key needed** — Your editor's AI (Cursor, Claude Code, Windsurf, Copilot) does the reasoning via MCP. Zero extra cost.
- **Type-aware** — Resolves full TypeScript interfaces so complex props get correctly-shaped nested data, not `{}`.
- **Self-healing** — Editor generates stories, validates them, and auto-fixes errors in a loop.
- **Always in sync** — Checksum-based verification catches prop drift. Watch mode regenerates on save.
- **Safe by default** — Never overwrites hand-edited stories. CI-friendly `--check` mode writes nothing.
- **Works everywhere** — MCP server for AI editors + CLI for CI/CD. One command: `sbook-ai setup`.

---

## Quick Start

### With any AI editor (recommended — no API key needed)

Your editor's built-in AI does the reasoning. The tool provides the data and writes the files.

```bash
npm install --save-dev storybook-ai-generator
npx sbook-ai setup --mcp
```

Then in your editor (Cursor, Claude Code, Windsurf, VS Code Copilot):

> "Generate Storybook stories for my components"

The editor's AI calls MCP tools to analyze your TypeScript types, understand how components are used, craft realistic args, generate stories, and validate they compile — all automatically.

### CLI mode (for CI/CD or batch generation)

```bash
npm install --save-dev storybook-ai-generator
npx sbook-ai generate ./src/components
```

### Launch Storybook

```bash
npx storybook@latest init   # if not already installed
npm run storybook
```

---

## How It Compares

No other tool combines TypeScript-aware prop detection, automatic variant stories, AI arg generation, and CI verification.

| Feature | sbook-ai | Storybook Autodocs | Plop / Hygen | storybook-genie | auto-story-generator |
|---|:---:|:---:|:---:|:---:|:---:|
| Generates `.stories.ts` files | **Yes** | No (docs only) | Template scaffold | Yes | Yes |
| TypeScript AST prop detection | **Yes** (ts-morph) | Via docgen (docs only) | No | No (sends to LLM) | Basic |
| Automatic variant stories | **Yes** | No | No | Non-deterministic | No |
| Smart arg values (no API key) | **Yes** (40+ patterns) | No | No | No | No |
| AI-powered args (Claude) | **Yes** | No | No | Yes (OpenAI/Ollama) | No |
| MCP server for AI editors | **10 tools** | Separate addon | No | No | No |
| Watch mode | **Yes** | No | No | No | Yes (Vite plugin) |
| CI verification (`--check`) | **Yes** | No | No | No | No |
| Hand-edit protection | **Yes** (checksums) | N/A | N/A | No | No |
| Deterministic output | **Yes** | N/A | Yes | No (LLM variance) | Unclear |
| `forwardRef`/`memo` support | **Yes** | Via docgen | No | No | No |
| Provider decorators | **Auto-detected** | Manual | No | No | No |
| Zero config | **Yes** | Requires Storybook config | Requires templates | Requires API key | Requires plugin setup |

---

## Features

### AI-Powered Arg Generation

The `--ai` flag generates realistic, context-aware values for every prop — no API key required.

```bash
npx sbook-ai generate ./src --ai
```

**How it works:** 40+ pattern matchers analyze prop names, types, JSDoc descriptions, and component context to pick appropriate values:

| Prop | Component | Generated Value |
|---|---|---|
| `email` | any | `"sarah@example.com"` |
| `price` | ProductCard | `9.99` |
| `name` | UserProfile | `"Sarah Johnson"` |
| `name` | ProductCard | `"Organic Avocados"` |
| `status` | StatusBadge | `"active"` |
| `variant` | Button | `"primary"` (+ variant stories) |
| `icon` | StatsCard | `Circle` (from lucide-react) |
| `disabled` | any | `false` (true in variant) |

**Want even smarter args?** Use MCP mode — your editor's AI generates args using full type definitions, real usage patterns, and existing mock data. No API key needed.

### Automatic Variant Stories

String union props automatically generate named stories for each value:

```tsx
variant?: 'primary' | 'secondary' | 'danger'
```

Produces:
```
export const Default: Story   → variant: "primary"
export const Primary: Story   → variant: "primary"
export const Secondary: Story → variant: "secondary"
export const Danger: Story    → variant: "danger"
```

Priority order: `variant > type > kind > size > color > theme`.

### Watch Mode

Keep stories in sync as you code:

```bash
npx sbook-ai watch ./src/components
```

- New component added → story generated
- Component props changed → story regenerated
- Component deleted → story removed

### Provider Decorators

Auto-detect state management libraries and generate `.storybook/preview.ts` with the right provider wrappers:

```bash
npx sbook-ai decorators ./src
```

Detects: Redux, Zustand, React Query, React Router, and more.

### MCP Server for AI Editors

The primary way to use sbook-ai. Your editor's AI orchestrates the tools — no API key needed.

```bash
npx sbook-ai setup --mcp
```

Auto-detects your editor and writes the config:

| Editor | Config File |
|---|---|
| Claude Code | `.mcp.json` |
| Cursor | `.cursor/mcp.json` |
| VS Code (Copilot) | `.vscode/mcp.json` |
| Windsurf | `.windsurf/mcp.json` |

**10 MCP tools available:**

| Tool | What it does |
|---|---|
| `list_components` | Discover all components with prop summaries |
| `get_component` | Full metadata: props, argTypes, variant detection |
| `get_type_definition` | Resolve full TypeScript interface trees for complex props |
| `find_usage_examples` | Find real JSX usage with actual prop values |
| `get_mock_fixtures` | Find existing test mocks and fixture data to reuse |
| `suggest_args` | Get heuristic-generated arg values (quick fallback) |
| `scan_project_context` | Find component usages, mock data, design tokens |
| `generate_stories` | Generate stories with custom args |
| `validate_story` | Check generated stories compile correctly |
| `check_stories` | Verify stories are in sync with components |

**How the editor uses them:**
1. `get_component` → understand the props
2. `get_type_definition` → resolve complex types like `Cart` into full interface trees
3. `find_usage_examples` + `get_mock_fixtures` → gather real project data
4. Editor's AI crafts type-correct args using all the context
5. `generate_stories` → write stories with the crafted args
6. `validate_story` → check they compile; fix and retry if not

### CI Verification

Catch story drift in pull requests:

```yaml
# .github/workflows/stories.yml
- run: npx sbook-ai generate --check    # validates without writing
- run: npx sbook-ai verify --typecheck  # confirms type safety
```

---

## All Commands

```bash
sbook-ai generate [dir]           # Generate stories
sbook-ai generate [dir] --ai      # Generate with smart arg values
sbook-ai generate [dir] --dry-run # Preview without writing
sbook-ai generate [dir] --check   # CI-safe validation (writes nothing)
sbook-ai generate [dir] --overwrite # Force overwrite existing stories

sbook-ai verify [dir]             # Check stories are in sync
sbook-ai verify [dir] --typecheck # Also run tsc on generated stories

sbook-ai watch [dir]              # Auto-regenerate on file changes

sbook-ai setup                    # Interactive MCP + API key setup
sbook-ai setup --mcp              # Just configure MCP server
sbook-ai setup --api-key          # Just set API key

sbook-ai decorators [dir]         # Auto-generate provider decorators
sbook-ai init [dir]               # Add Windsurf Cascade skills
sbook-ai serve                    # Start MCP server (stdio)
sbook-ai update                   # Pull latest + rebuild
```

All commands default to the current directory when `[dir]` is omitted.

---

## Installation

### As a dev dependency (recommended)

```bash
npm install --save-dev storybook-ai-generator
```

Add to `package.json` for convenience:

```json
{
  "scripts": {
    "stories:generate": "sbook-ai generate ./src/components --ai",
    "stories:verify": "sbook-ai verify ./src/components",
    "stories:watch": "sbook-ai watch ./src/components"
  }
}
```

### Global

```bash
npm install -g storybook-ai-generator
sbook-ai generate
```

### From source

```bash
git clone https://github.com/nngu3010/storybook-ai-generator.git
cd storybook-ai-generator
npm install && npm run build && npm link
```

---

## Safety Guarantees

| Concern | How it's handled |
|---|---|
| Overwrites hand-edited stories | **Never.** Writes `.stories.generated.ts` on conflict |
| Breaks the build | `--check` validates in a temp dir first |
| Outdated stories | `verify` detects prop drift via checksums |
| Invalid TypeScript | `--typecheck` runs `tsc --noEmit` on generated files |
| Re-running is destructive | **Idempotent** — skips unchanged components |

Every generated file has a checksum header:

```ts
// @sbook-ai checksum: a49a938c05dd generated: 2026-03-18
// AUTO-GENERATED — do not edit this file manually.
```

---

## What It Understands

### TypeScript types → Storybook controls

| TypeScript type | Storybook control |
|---|---|
| `string` | `text` |
| `number` | `number` |
| `boolean` | `boolean` |
| `'a' \| 'b' \| 'c'` | `select` with options |
| `1 \| 2 \| 3` | `select` with options |
| `() => void` | `action` |
| `ReactNode` | excluded from controls |
| `LucideIcon`, `ComponentType` | component ref with auto-import |
| arrays, objects, `CSSProperties` | `object` |

### Component patterns supported

- Default exports (function declarations, arrow functions, function expressions)
- `React.forwardRef()` and `React.memo()` (including nested `memo(forwardRef(...))`)
- `React.FC<Props>` and `FunctionComponent<Props>`
- Intersection types (`PropsA & PropsB`)
- TypeScript enums as string literal unions
- tsconfig path aliases
- JSDoc comments and `@deprecated` tags

---

## Example

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

Running `sbook-ai generate --ai` produces `Button.stories.ts`:

```ts
// @sbook-ai checksum: a49a938c05dd generated: 2026-03-18
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

export const Default:   Story = { args: { label: "Save changes", variant: "primary", disabled: false } };
export const Primary:   Story = { args: { label: "Submit", disabled: false, variant: "primary" } };
export const Secondary: Story = { args: { label: "Learn more", disabled: false, variant: "secondary" } };
export const Danger:    Story = { args: { label: "Get started", disabled: false, variant: "danger" } };
```

---

## Roadmap

### v0.3 — Smarter Context-Aware Args

Use your actual codebase to generate better values — no API key needed.

- [ ] Extract arg values from real component usages in the project
- [ ] Pull sample data from mock/fixture files
- [ ] Infer prop relationships (`originalPrice > price`, `isOpen` + `onClose` paired)
- [ ] Generate meaningful JSX children for `ReactNode` props

### v0.4 — Framework & Ecosystem Expansion

- [ ] Vue 3 support (`<script setup>` + `defineProps()`)
- [ ] Generate Storybook interaction tests (`play` functions)
- [ ] Accessibility-focused variant stories
- [ ] Design token integration (use real theme colors/spacing)
- [ ] Monorepo support (Turborepo, Nx, pnpm workspaces)

### v0.5 — AI Story Quality

- [ ] Scenario-based stories (empty state, error state, loading, overflow)
- [ ] Multi-component composition stories
- [ ] MDX documentation generation
- [ ] Story quality scoring
- [ ] Diff-aware regeneration (only re-generate changed props)

### v0.6 — CI/CD & Team Workflows

- [ ] Official GitHub Action
- [ ] PR preview links (Chromatic integration)
- [ ] `.sbookrc` config file
- [ ] Custom team pattern library
- [ ] Shared arg presets

### v1.0 — IDE Deep Integration

- [ ] Inline story preview via MCP resources
- [ ] Story drift diagnostics in editor
- [ ] Interactive arg editor (generate → preview → refine loop)
- [ ] Component catalog as MCP resource

---

## Component Requirements

sbook-ai works best when components:

- Have a **default export** (function or arrow function)
- Have **typed props** with a TypeScript interface or type
- Use **JSDoc comments** on props for auto-generated descriptions
- Use **string literal unions** for variant props (`'primary' | 'secondary'`)
- Use **destructuring with defaults** for default prop values

---

## Development

```bash
npm test           # watch mode
npm run test:run   # single run (240 tests)
npm run build      # compile TypeScript
npm run dev        # build in watch mode
```

### Test Suite (240 tests)

| File | Tests | Coverage |
|---|---|---|
| `typeMapper.test.ts` | 61 | Type → control mapping, nullable stripping, component refs |
| `aiArgs.test.ts` | 21 | Heuristic args, Claude fallback, component ref inference |
| `heuristics.test.ts` | 20 | Component detection accuracy |
| `variantDetector.test.ts` | 20 | Variant prop priority and story generation |
| `decorators.test.ts` | 18 | Provider detection and preview.ts generation |
| `sampleAppAi.test.ts` | 16 | Real-world component AI arg generation |
| `enumAndObject.test.ts` | 16 | Enum expansion, Record/object defaults |
| `integration.test.ts` | 15 | Full pipeline: detect → parse → generate → write |
| `forwardRefMemo.test.ts` | 15 | forwardRef/memo unwrapping |
| `mcp.test.ts` | 28 | MCP tools: list, get, suggest_args, context scanner, integration |
| `e2e.test.ts` | 6 | End-to-end generation + TypeScript validation |
| `tsconfig-alias.test.ts` | 4 | Path alias resolution |

---

## License

MIT
