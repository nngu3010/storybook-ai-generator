import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { findComponents } from '../src/detector/componentFinder.js';
import { buildProgram } from '../src/parser/programBuilder.js';
import { parseComponent } from '../src/parser/componentParser.js';
import { buildStoryContent } from '../src/generator/storyBuilder.js';

const FIXTURES_DIR = path.resolve('tests/fixtures');

let componentFiles: string[];
let project: ReturnType<typeof buildProgram>;

beforeAll(async () => {
  componentFiles = await findComponents(FIXTURES_DIR);
  project = buildProgram(FIXTURES_DIR, componentFiles);
});

// ---------------------------------------------------------------------------
// React.forwardRef
// ---------------------------------------------------------------------------
describe('forwardRef: parsing', () => {
  it('detects ForwardRefButton as a component (not skipped)', () => {
    const file = componentFiles.find((f) => f.endsWith('ForwardRefButton.tsx'))!;
    expect(file).toBeDefined();
    const meta = parseComponent(project, file);
    expect(meta.skipReason).toBeUndefined();
  });

  it('resolves component name from variable declaration', () => {
    const file = componentFiles.find((f) => f.endsWith('ForwardRefButton.tsx'))!;
    const meta = parseComponent(project, file);
    expect(meta.name).toBe('ForwardRefButton');
  });

  it('extracts props from forwardRef render function', () => {
    const file = componentFiles.find((f) => f.endsWith('ForwardRefButton.tsx'))!;
    const meta = parseComponent(project, file);
    const propNames = meta.props.map((p) => p.name);
    expect(propNames).toContain('label');
    expect(propNames).toContain('variant');
    expect(propNames).toContain('disabled');
    expect(propNames).toContain('onClick');
  });

  it('correctly marks required and optional props', () => {
    const file = componentFiles.find((f) => f.endsWith('ForwardRefButton.tsx'))!;
    const meta = parseComponent(project, file);
    const label = meta.props.find((p) => p.name === 'label')!;
    expect(label.required).toBe(true);
    const variant = meta.props.find((p) => p.name === 'variant')!;
    expect(variant.required).toBe(false);
    expect(variant.defaultValue).toMatch(/primary/);
  });

  it('does not include ref as a prop', () => {
    const file = componentFiles.find((f) => f.endsWith('ForwardRefButton.tsx'))!;
    const meta = parseComponent(project, file);
    const propNames = meta.props.map((p) => p.name);
    expect(propNames).not.toContain('ref');
  });
});

describe('forwardRef: story generation', () => {
  it('generates a valid story for ForwardRefButton', () => {
    const file = componentFiles.find((f) => f.endsWith('ForwardRefButton.tsx'))!;
    const meta = parseComponent(project, file);
    const content = buildStoryContent(meta, 'ForwardRefButton.tsx');

    expect(content).toMatch(/\/\/ @sbook-ai checksum:/);
    expect(content).toContain("import ForwardRefButton from './ForwardRefButton'");
    expect(content).toContain('export const Default: Story');
  });

  it('generates variant stories from forwardRef props', () => {
    const file = componentFiles.find((f) => f.endsWith('ForwardRefButton.tsx'))!;
    const meta = parseComponent(project, file);
    const content = buildStoryContent(meta, 'ForwardRefButton.tsx');

    expect(content).toContain('export const Primary: Story');
    expect(content).toContain('export const Secondary: Story');
    expect(content).toContain('export const Danger: Story');
  });
});

// ---------------------------------------------------------------------------
// React.memo
// ---------------------------------------------------------------------------
describe('memo: parsing', () => {
  it('detects MemoCard as a component (not skipped)', () => {
    const file = componentFiles.find((f) => f.endsWith('MemoCard.tsx'))!;
    expect(file).toBeDefined();
    const meta = parseComponent(project, file);
    expect(meta.skipReason).toBeUndefined();
  });

  it('resolves component name for memo-wrapped component', () => {
    const file = componentFiles.find((f) => f.endsWith('MemoCard.tsx'))!;
    const meta = parseComponent(project, file);
    expect(meta.name).toBe('MemoCard');
  });

  it('extracts props from memo-wrapped component', () => {
    const file = componentFiles.find((f) => f.endsWith('MemoCard.tsx'))!;
    const meta = parseComponent(project, file);
    const propNames = meta.props.map((p) => p.name);
    expect(propNames).toContain('title');
    expect(propNames).toContain('description');
    expect(propNames).toContain('size');
  });

  it('generates variant stories for memo-wrapped component', () => {
    const file = componentFiles.find((f) => f.endsWith('MemoCard.tsx'))!;
    const meta = parseComponent(project, file);
    const content = buildStoryContent(meta, 'MemoCard.tsx');

    expect(content).toContain('export const Sm: Story');
    expect(content).toContain('export const Md: Story');
    expect(content).toContain('export const Lg: Story');
  });
});

// ---------------------------------------------------------------------------
// React.memo(React.forwardRef(...))
// ---------------------------------------------------------------------------
describe('memo + forwardRef: parsing', () => {
  it('detects MemoForwardRef as a component (not skipped)', () => {
    const file = componentFiles.find((f) => f.endsWith('MemoForwardRef.tsx'))!;
    expect(file).toBeDefined();
    const meta = parseComponent(project, file);
    expect(meta.skipReason).toBeUndefined();
  });

  it('extracts props from memo(forwardRef(...)) combination', () => {
    const file = componentFiles.find((f) => f.endsWith('MemoForwardRef.tsx'))!;
    const meta = parseComponent(project, file);
    const propNames = meta.props.map((p) => p.name);
    expect(propNames).toContain('label');
    expect(propNames).toContain('placeholder');
    expect(propNames).toContain('disabled');
  });

  it('does not include ref as a prop for memo(forwardRef(...))', () => {
    const file = componentFiles.find((f) => f.endsWith('MemoForwardRef.tsx'))!;
    const meta = parseComponent(project, file);
    expect(meta.props.map((p) => p.name)).not.toContain('ref');
  });

  it('generates a valid story for memo(forwardRef(...))', () => {
    const file = componentFiles.find((f) => f.endsWith('MemoForwardRef.tsx'))!;
    const meta = parseComponent(project, file);
    const content = buildStoryContent(meta, 'MemoForwardRef.tsx');

    expect(content).toMatch(/\/\/ @sbook-ai checksum:/);
    expect(content).toContain('export const Default: Story');
  });
});
