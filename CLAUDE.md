# storybook-gen

CLI tool that auto-generates Storybook stories from React/TypeScript components.

## Build & Test

```bash
npm run build        # TypeScript compile
npm run test:run     # Run all 104 tests
npm test             # Watch mode
```

## Architecture

- `src/cli/` — Commander CLI with `generate` and `verify` commands
- `src/detector/` — Component file discovery via glob + heuristics
- `src/parser/` — ts-morph AST parsing for props extraction
- `src/mapper/` — TypeScript type → Storybook argType mapping
- `src/generator/` — CSF3 story file builder + collision-safe writer
- `tests/fixtures/` — Sample React components used by tests

## Key Design Decisions

- Single `ts-morph` Project per run (not per file) for cross-file type resolution
- Checksum headers in generated files for safe idempotent re-runs
- Never overwrites hand-edited stories without `--overwrite` flag
- `--check` mode validates in a temp dir — safe for CI, writes nothing

## CLI Commands

```bash
storybook-gen generate <dir> [--dry-run] [--overwrite] [--check]
storybook-gen verify <dir> [--typecheck]
```

## Custom Slash Command

`/storybook` — runs the full verify → generate → verify workflow. Defined in `.claude/commands/storybook.md`.
