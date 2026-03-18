# sbook-ai Roadmap

## Current State (v0.2.x)

CLI tool that auto-generates Storybook CSF3 stories from React/TypeScript components. Supports:

- AST-based prop extraction via ts-morph
- Variant detection from string literal unions
- Component ref inference (LucideIcon, react-icons, ComponentType)
- forwardRef/memo unwrapping, tsconfig path aliases
- `--ai` flag with heuristic-based arg generation (no API key) or Claude-powered args (with key)
- MCP server with 7 tools for agent-driven story generation
- `setup` command with auto-detection for Claude Code, Cursor, VS Code, Windsurf
- `watch` mode, `verify` with typecheck, `decorators` for auto-generating provider wrappers
- Idempotent re-runs with checksum headers; never overwrites hand-edited stories

---

## Phase 1: Smarter Context-Aware Args (v0.3)

**Goal:** Bridge the gap between hard-coded heuristics and full LLM calls. Use project context to generate realistic args without an API key.

- [ ] **Context-enriched heuristics** — Feed `scan_project_context` results into the CLI `--ai` path. If `<StatsCard title="Total Revenue" />` exists in the codebase, use `"Total Revenue"` instead of generic `"Welcome to Our Store"`.
- [ ] **Import-aware mock data** — When a component's usage file imports from a `mock*` or `fixture*` file, extract and use those values as story args.
- [ ] **Prop relationship inference** — Detect correlated props (e.g., `price` + `originalPrice` should have `originalPrice > price`; `isOpen` + `onClose` always paired).
- [ ] **Children/render prop support** — Generate meaningful JSX children for components that accept `ReactNode` or render props, not just empty stories.

## Phase 2: Framework & Ecosystem Expansion (v0.4)

**Goal:** Support more frameworks and integrate with the broader Storybook ecosystem.

- [ ] **Vue 3 support** — Parse `<script setup>` + `defineProps()` and generate Vue CSF3 stories.
- [ ] **Storybook Interaction Tests** — Generate `play` functions for interactive components (forms, modals, dropdowns) using `@storybook/test`.
- [ ] **Accessibility stories** — Auto-generate a11y-focused variant stories (keyboard nav, screen reader, high contrast) when components have ARIA props.
- [ ] **Design token integration** — When theme/token files are detected, use actual project colors, spacing, and typography values in args instead of generic hex codes.
- [ ] **Monorepo support** — Detect workspace structure (Turborepo, Nx, pnpm workspaces) and generate stories per package with correct import paths.

## Phase 3: AI-Powered Story Quality (v0.5)

**Goal:** Use LLM reasoning to generate stories that are actually useful for design review and testing.

- [ ] **Visual scenario generation** — Instead of just Default + variant stories, generate scenario-based stories: empty state, error state, loading state, overflow text, edge case data.
- [ ] **Multi-component compositions** — Detect parent-child component relationships and generate composition stories (e.g., `Form` with `Input` + `Button` children).
- [ ] **Storybook docs generation** — Generate MDX documentation pages alongside stories with usage examples, do's and don'ts, and prop tables.
- [ ] **Story quality scoring** — Rate generated stories on coverage (prop combinations exercised), realism (arg values make sense), and visual diversity.
- [ ] **Diff-aware regeneration** — On `git diff`, only regenerate stories for components whose props actually changed, preserving manually tweaked args for unchanged props.

## Phase 4: CI/CD & Team Workflows (v0.6)

**Goal:** Make sbook-ai a team tool, not just a developer tool.

- [ ] **GitHub Action** — Official action that runs `generate --check` + `verify --typecheck` on PRs, with inline comments for outdated stories.
- [ ] **PR story preview** — Generate a Chromatic/Storybook deploy preview link in PR comments showing only the stories that changed.
- [ ] **Config file (`.sbookrc`)** — Project-level config for: component directories, ignore patterns, arg overrides, preferred variant prop names, custom heuristic patterns.
- [ ] **Team patterns library** — Allow teams to define custom `STRING_PATTERNS` and context rules (e.g., "in our project, `amount` is always in cents, divide by 100 for display").
- [ ] **Shared arg presets** — `sbook-ai presets` command to export/import arg value sets across projects.

## Phase 5: IDE Deep Integration (v1.0)

**Goal:** Seamless developer experience regardless of editor.

- [ ] **Inline story preview** — MCP resource that returns a rendered preview URL for a component's stories, displayable in IDE hover panels.
- [ ] **Auto-regenerate on save** — File watcher that triggers story update only when prop types change (not on implementation changes).
- [ ] **Story drift alerts** — IDE diagnostics (warnings) when a story file is out of sync with its component.
- [ ] **Interactive arg editor** — MCP tool that lets the assistant iteratively refine args: generate → preview → adjust → regenerate, without writing intermediate files.
- [ ] **Component catalog MCP resource** — Expose the full component inventory as an MCP resource so assistants can browse components without tool calls.

---

## Non-Goals

Things we deliberately do not plan to build:

- **Runtime story rendering** — We generate static CSF3 files. Rendering is Storybook's job.
- **Custom Storybook addons** — We integrate with existing addons, not replace them.
- **Component generation** — We generate stories *for* components, not the components themselves.
- **Testing framework** — We generate stories, not unit tests. Use Storybook's test runner or other tools for that.
