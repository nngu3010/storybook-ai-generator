import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { findComponents } from '../src/detector/componentFinder.js';
import { buildProgram } from '../src/parser/programBuilder.js';
import { parseComponent } from '../src/parser/componentParser.js';
import { buildStoryContent } from '../src/generator/storyBuilder.js';
import { mapPropToArgType, getDefaultArg } from '../src/mapper/typeMapper.js';
import type { PropMeta } from '../src/parser/componentParser.js';

const FIXTURES_DIR = path.resolve('tests/fixtures');

let componentFiles: string[];
let project: ReturnType<typeof buildProgram>;

beforeAll(async () => {
  componentFiles = await findComponents(FIXTURES_DIR);
  project = buildProgram(FIXTURES_DIR, componentFiles);
});

// ---------------------------------------------------------------------------
// Enum support
// ---------------------------------------------------------------------------

describe('enum: parsing', () => {
  it('detects StatusBadge component', () => {
    const file = componentFiles.find((f) => f.endsWith('StatusBadge.tsx'))!;
    expect(file).toBeDefined();
    const meta = parseComponent(project, file);
    expect(meta.skipReason).toBeUndefined();
    expect(meta.name).toBe('StatusBadge');
  });

  it('expands string enum to literal union in typeName', () => {
    const file = componentFiles.find((f) => f.endsWith('StatusBadge.tsx'))!;
    const meta = parseComponent(project, file);
    const status = meta.props.find((p) => p.name === 'status')!;
    expect(status).toBeDefined();
    // Should be expanded to string literal union, not "Status"
    expect(status.typeName).toMatch(/active/);
    expect(status.typeName).toMatch(/inactive/);
    expect(status.typeName).toMatch(/pending/);
  });

  it('expands number enum to numeric literal union in typeName', () => {
    const file = componentFiles.find((f) => f.endsWith('StatusBadge.tsx'))!;
    const meta = parseComponent(project, file);
    const priority = meta.props.find((p) => p.name === 'priority')!;
    expect(priority).toBeDefined();
    // Should be expanded to number literals
    expect(priority.typeName).toMatch(/0/);
    expect(priority.typeName).toMatch(/1/);
    expect(priority.typeName).toMatch(/2/);
  });
});

describe('enum: argType mapping', () => {
  it('maps string enum to select control with options', () => {
    const file = componentFiles.find((f) => f.endsWith('StatusBadge.tsx'))!;
    const meta = parseComponent(project, file);
    const status = meta.props.find((p) => p.name === 'status')!;
    const argType = mapPropToArgType(status);

    expect(argType.control).toBe('select');
    expect(argType.options).toContain('active');
    expect(argType.options).toContain('inactive');
    expect(argType.options).toContain('pending');
  });

  it('maps number enum to select control with options', () => {
    const file = componentFiles.find((f) => f.endsWith('StatusBadge.tsx'))!;
    const meta = parseComponent(project, file);
    const priority = meta.props.find((p) => p.name === 'priority')!;
    const argType = mapPropToArgType(priority);

    expect(argType.control).toBe('select');
    expect(argType.options).toBeDefined();
  });

  it('uses first enum value as default arg', () => {
    const file = componentFiles.find((f) => f.endsWith('StatusBadge.tsx'))!;
    const meta = parseComponent(project, file);
    const status = meta.props.find((p) => p.name === 'status')!;
    const defaultArg = getDefaultArg(status);
    expect(defaultArg).toBe('active');
  });
});

describe('enum: story generation', () => {
  it('generates variant stories from string enum values', () => {
    const file = componentFiles.find((f) => f.endsWith('StatusBadge.tsx'))!;
    const meta = parseComponent(project, file);
    const content = buildStoryContent(meta, 'StatusBadge.tsx');

    expect(content).toContain('export const Default: Story');
    expect(content).toContain('export const Active: Story');
    expect(content).toContain('export const Inactive: Story');
    expect(content).toContain('export const Pending: Story');
  });

  it('includes checksum and proper imports', () => {
    const file = componentFiles.find((f) => f.endsWith('StatusBadge.tsx'))!;
    const meta = parseComponent(project, file);
    const content = buildStoryContent(meta, 'StatusBadge.tsx');

    expect(content).toMatch(/\/\/ @sbook-ai checksum:/);
    expect(content).toContain("import StatusBadge from './StatusBadge'");
  });
});

// ---------------------------------------------------------------------------
// Record / object type support
// ---------------------------------------------------------------------------

describe('Record/object type: defaults', () => {
  it('defaults Record<string, string> to empty object', () => {
    const file = componentFiles.find((f) => f.endsWith('StatusBadge.tsx'))!;
    const meta = parseComponent(project, file);
    const metadata = meta.props.find((p) => p.name === 'metadata')!;
    expect(metadata).toBeDefined();

    const defaultArg = getDefaultArg(metadata);
    expect(defaultArg).toEqual({});
  });

  it('renders empty object in story args', () => {
    const file = componentFiles.find((f) => f.endsWith('StatusBadge.tsx'))!;
    const meta = parseComponent(project, file);
    const content = buildStoryContent(meta, 'StatusBadge.tsx');

    // metadata should be {} in the Default story args
    expect(content).toMatch(/metadata: \{\}/);
  });
});

// ---------------------------------------------------------------------------
// getDefaultArg for various types
// ---------------------------------------------------------------------------

describe('getDefaultArg: extended types', () => {
  it('returns [] for array type', () => {
    const prop: PropMeta = { name: 'items', typeName: 'Item[]', required: true };
    expect(getDefaultArg(prop)).toEqual([]);
  });

  it('returns [] for Array<T> type', () => {
    const prop: PropMeta = { name: 'items', typeName: 'Array<Item>', required: true };
    expect(getDefaultArg(prop)).toEqual([]);
  });

  it('returns {} for Record type', () => {
    const prop: PropMeta = { name: 'data', typeName: 'Record<string, number>', required: true };
    expect(getDefaultArg(prop)).toEqual({});
  });

  it('returns {} for inline object type', () => {
    const prop: PropMeta = { name: 'style', typeName: '{ color: string; size: number }', required: true };
    expect(getDefaultArg(prop)).toEqual({});
  });

  it('parses [] default from ts-morph', () => {
    const prop: PropMeta = { name: 'items', typeName: 'Item[]', required: false, defaultValue: '[]' };
    expect(getDefaultArg(prop)).toEqual([]);
  });

  it('parses {} default from ts-morph', () => {
    const prop: PropMeta = { name: 'config', typeName: 'Config', required: false, defaultValue: '{}' };
    expect(getDefaultArg(prop)).toEqual({});
  });
});
