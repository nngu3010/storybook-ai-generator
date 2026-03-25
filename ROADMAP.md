# sbook-ai Roadmap

## Architecture: MCP-First

The core insight: developers already pay for AI through their editor subscriptions (Cursor, Claude Code, Windsurf, Copilot). Instead of the tool calling an LLM internally (requiring an API key), the tool exposes rich MCP tools and the editor's AI does all the reasoning.

**The tool is the hands. The editor's AI is the brain.**

## Current State (v0.3.x)

- 10 MCP tools for AI editor integration (no API key needed)
- AST-based prop extraction via ts-morph with full cross-file type resolution
- Recursive type definition resolver (up to 6 levels deep)
- Type-aware heuristic arg generation with 40+ patterns
- Prop relationship inference (price pairs, min/max, state+handler)
- Variant detection from string literal unions
- Component ref inference (LucideIcon, react-icons, ComponentType)
- forwardRef/memo unwrapping, tsconfig path aliases
- `.stories.tsx` extension when JSX content detected
- `setup` command with auto-detection for Claude Code, Cursor, VS Code, Windsurf
- `watch` mode, `verify` with typecheck, `decorators` for auto-generating provider wrappers
- Idempotent re-runs with checksum headers; never overwrites hand-edited stories
- 423 tests across 26 test files

---

## Phase 1: MCP Foundation (v0.3) — COMPLETE

**Goal:** Give AI editors everything they need to generate production-quality stories.

- [x] **MCP server with 10 tools** — list, get, generate, validate, check, suggest, scan context
- [x] **Type resolution MCP tool** — `get_type_definition` resolves full interface trees recursively
- [x] **Usage example MCP tool** — `find_usage_examples` finds real JSX usage with actual prop values
- [x] **Story validation MCP tool** — `validate_story` checks TypeScript compilation, enables self-healing loops
- [x] **Mock fixture MCP tool** — `get_mock_fixtures` finds test data to reuse in story args
- [x] **Context-enriched heuristics** — Feed project context into `--ai` path for CLI mode
- [x] **Import-aware mock data** — Extract and use mock/fixture values as story args
- [x] **Prop relationship inference** — Detect correlated props (price pairs, min/max, state+handler)
- [x] **Type-aware arg generation** — Resolve TypeScript interfaces to generate correctly-shaped nested objects
- [x] **Enhanced tool descriptions** — Workflow guidance in tool descriptions for better LLM orchestration
- [x] **Prompt templates** — Claude Code slash commands encoding the full generate → validate → fix workflow
- [x] **Editor config templates** — Ready-to-use MCP configs for Cursor, VS Code, Windsurf, Claude Code

## Phase 2: Framework & Ecosystem Expansion (v0.4)

**Goal:** Support more frameworks and integrate with the broader Storybook ecosystem.

- [ ] **Vue 3 support** — Parse `<script setup>` + `defineProps()` and generate Vue CSF3 stories.
- [ ] **Storybook Interaction Tests** — Generate `play` functions for interactive components (forms, modals, dropdowns) using `@storybook/test`.
- [ ] **Accessibility stories** — Auto-generate a11y-focused variant stories (keyboard nav, screen reader, high contrast) when components have ARIA props.
- [ ] **Design token integration** — When theme/token files are detected, use actual project colors, spacing, and typography values in args instead of generic hex codes.
- [ ] **Monorepo support** — Detect workspace structure (Turborepo, Nx, pnpm workspaces) and generate stories per package with correct import paths.

## Phase 3: AI-Powered Story Quality (v0.5)

**Goal:** Use the editor's LLM to generate stories that are useful for design review and testing.

- [ ] **Visual scenario generation** — Generate scenario-based stories: empty state, error state, loading state, overflow text, edge case data.
- [ ] **Multi-component compositions** — Detect parent-child component relationships and generate composition stories.
- [ ] **Storybook docs generation** — Generate MDX documentation pages alongside stories.
- [ ] **Story quality scoring** — Rate generated stories on coverage, realism, and visual diversity.
- [ ] **Diff-aware regeneration** — Only regenerate stories for components whose props actually changed.

## Phase 4: CI/CD & Team Workflows (v0.6)

**Goal:** Make sbook-ai a team tool, not just a developer tool.

- [ ] **GitHub Action** — Official action that runs `generate --check` + `verify --typecheck` on PRs.
- [ ] **PR story preview** — Generate Chromatic/Storybook deploy preview links in PR comments.
- [ ] **Config file (`.sbookrc`)** — Project-level config for component directories, ignore patterns, arg overrides.
- [ ] **Team patterns library** — Custom patterns and context rules per project.

## Phase 5: IDE Deep Integration (v1.0)

**Goal:** Seamless developer experience regardless of editor.

- [ ] **Inline story preview** — MCP resource that returns a rendered preview URL.
- [ ] **Story drift alerts** — IDE diagnostics when a story file is out of sync.
- [ ] **Interactive arg editor** — MCP tool for iterative arg refinement: generate → preview → adjust → regenerate.
- [ ] **Component catalog MCP resource** — Expose the full component inventory as an MCP resource.

---

## Non-Goals

- **Runtime story rendering** — We generate static CSF3 files. Rendering is Storybook's job.
- **Custom Storybook addons** — We integrate with existing addons, not replace them.
- **Component generation** — We generate stories *for* components, not the components themselves.
- **Testing framework** — We generate stories, not unit tests. Use Storybook's test runner for that.
- **Internal LLM dependency** — The tool should work without an API key. AI reasoning comes from the editor.
