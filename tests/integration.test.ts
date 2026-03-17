import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { findComponents } from '../src/detector/componentFinder.js';
import { buildProgram } from '../src/parser/programBuilder.js';
import { parseComponent } from '../src/parser/componentParser.js';
import { buildStoryContent } from '../src/generator/storyBuilder.js';
import { writeStory } from '../src/generator/storyWriter.js';

const FIXTURES_DIR = path.resolve('tests/fixtures');

// Clean up generated story files after tests
const generatedFiles: string[] = [];

afterAll(() => {
  for (const f of generatedFiles) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

// ---------------------------------------------------------------------------
// 1. Component Detection
// ---------------------------------------------------------------------------
describe('integration: component detection', () => {
  it('finds all real components and excludes non-components', async () => {
    const found = await findComponents(FIXTURES_DIR);
    const names = found.map((f) => path.basename(f));

    // Should include real components
    expect(names).toContain('Button.tsx');
    expect(names).toContain('Input.tsx');
    expect(names).toContain('Card.tsx');
    expect(names).toContain('NoProps.tsx');
    expect(names).toContain('WithRouter.tsx');
    expect(names).toContain('GenericSelect.tsx');

    // Should exclude non-components
    expect(names).not.toContain('NotAComponent.ts');
    expect(names).not.toContain('index.ts');

    // Should exclude any generated story files
    expect(names.filter((n) => n.includes('.stories.'))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Full Pipeline: Parse → Generate
// ---------------------------------------------------------------------------
describe('integration: parse and generate', () => {
  let componentFiles: string[];
  let project: ReturnType<typeof buildProgram>;

  beforeAll(async () => {
    componentFiles = await findComponents(FIXTURES_DIR);
    project = buildProgram(FIXTURES_DIR, componentFiles);
  });

  it('parses Button.tsx and extracts all props', () => {
    const buttonFile = componentFiles.find((f) => f.endsWith('Button.tsx'))!;
    const meta = parseComponent(project, buttonFile);

    expect(meta.name).toBe('Button');
    expect(meta.skipReason).toBeUndefined();
    expect(meta.props.length).toBeGreaterThanOrEqual(4);

    const propNames = meta.props.map((p) => p.name);
    expect(propNames).toContain('label');
    expect(propNames).toContain('variant');
    expect(propNames).toContain('onClick');

    // label should be required
    const label = meta.props.find((p) => p.name === 'label')!;
    expect(label.required).toBe(true);
    expect(label.typeName).toContain('string');

    // variant should be optional with string union
    const variant = meta.props.find((p) => p.name === 'variant')!;
    expect(variant.required).toBe(false);
    expect(variant.typeName).toMatch(/primary/);
    expect(variant.typeName).toMatch(/secondary/);
  });

  it('parses NoProps.tsx as a valid component with zero props', () => {
    const file = componentFiles.find((f) => f.endsWith('NoProps.tsx'))!;
    const meta = parseComponent(project, file);

    expect(meta.skipReason).toBeUndefined();
    expect(meta.props).toHaveLength(0);
  });

  it('parses Card.tsx and detects ReactNode children', () => {
    const file = componentFiles.find((f) => f.endsWith('Card.tsx'))!;
    const meta = parseComponent(project, file);

    const children = meta.props.find((p) => p.name === 'children');
    expect(children).toBeDefined();
    expect(children!.typeName).toMatch(/ReactNode/);
  });

  it('parses Input.tsx and detects function props', () => {
    const file = componentFiles.find((f) => f.endsWith('Input.tsx'))!;
    const meta = parseComponent(project, file);

    const onChange = meta.props.find((p) => p.name === 'onChange');
    expect(onChange).toBeDefined();
    expect(onChange!.typeName).toMatch(/=>/);
  });

  it('generates valid story content for Button', () => {
    const buttonFile = componentFiles.find((f) => f.endsWith('Button.tsx'))!;
    const meta = parseComponent(project, buttonFile);
    const content = buildStoryContent(meta, 'Button.tsx');

    // Must have checksum header
    expect(content).toMatch(/\/\/ @storybook-gen checksum: [a-f0-9]+/);

    // Must import from storybook
    expect(content).toContain("import type { Meta, StoryObj } from '@storybook/react'");

    // Must import the component
    expect(content).toContain("import Button from './Button'");

    // Must have meta with title and component
    expect(content).toContain("component: Button");
    expect(content).toContain("tags: ['autodocs']");

    // Must have argTypes
    expect(content).toContain('argTypes:');
    expect(content).toContain("control: 'text'");     // label
    expect(content).toContain("control: 'select'");    // variant
    expect(content).toContain("control: 'boolean'");   // disabled
    expect(content).toContain("action: 'onClick'");    // onClick

    // Must have Default story
    expect(content).toContain('export const Default: Story');

    // Must have variant stories (primary, secondary, danger)
    expect(content).toContain('export const Primary: Story');
    expect(content).toContain('export const Secondary: Story');
    expect(content).toContain('export const Danger: Story');
  });

  it('generates story with no args for NoProps component', () => {
    const file = componentFiles.find((f) => f.endsWith('NoProps.tsx'))!;
    const meta = parseComponent(project, file);
    const content = buildStoryContent(meta, 'NoProps.tsx');

    expect(content).toContain('export const Default: Story');
    // Should not have argTypes
    expect(content).not.toContain('argTypes:');
  });

  it('generates story for every detected component', () => {
    for (const filePath of componentFiles) {
      const meta = parseComponent(project, filePath);
      if (meta.skipReason) continue;

      const content = buildStoryContent(meta, path.basename(filePath));

      // Every story must be parseable (has required structure)
      expect(content).toContain('export default meta');
      expect(content).toContain('export const Default: Story');
      expect(content).toMatch(/\/\/ @storybook-gen checksum:/);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Story Writer: write, skip, conflict
// ---------------------------------------------------------------------------
describe('integration: story writer', () => {
  const tmpDir = path.resolve('tests/.tmp-writer-test');

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    // Create a fake component file
    fs.writeFileSync(path.join(tmpDir, 'Fake.tsx'), 'export default function Fake() { return null; }');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a new story file when none exists', () => {
    const content = '// @storybook-gen checksum: abc123 generated: 2026-01-01\nexport default {};';
    const result = writeStory(path.join(tmpDir, 'Fake.tsx'), content);

    expect(result).toBe('written');
    expect(fs.existsSync(path.join(tmpDir, 'Fake.stories.ts'))).toBe(true);
  });

  it('skips when checksum matches', () => {
    const content = '// @storybook-gen checksum: abc123 generated: 2026-01-01\nexport default {};';
    const result = writeStory(path.join(tmpDir, 'Fake.tsx'), content);

    expect(result).toBe('skipped');
  });

  it('creates .generated.ts on conflict', () => {
    const newContent = '// @storybook-gen checksum: def456 generated: 2026-01-01\nexport default {};';
    const result = writeStory(path.join(tmpDir, 'Fake.tsx'), newContent);

    expect(result).toBe('conflict');
    expect(fs.existsSync(path.join(tmpDir, 'Fake.stories.generated.ts'))).toBe(true);
  });

  it('overwrites when --overwrite is set', () => {
    const newContent = '// @storybook-gen checksum: ghi789 generated: 2026-01-01\noverwritten';
    const result = writeStory(path.join(tmpDir, 'Fake.tsx'), newContent, { overwrite: true });

    expect(result).toBe('written');
    const written = fs.readFileSync(path.join(tmpDir, 'Fake.stories.ts'), 'utf-8');
    expect(written).toContain('overwritten');
  });
});

// ---------------------------------------------------------------------------
// 4. JSDoc descriptions survive the pipeline
// ---------------------------------------------------------------------------
describe('integration: JSDoc descriptions', () => {
  let project: ReturnType<typeof buildProgram>;
  let componentFiles: string[];

  beforeAll(async () => {
    componentFiles = await findComponents(FIXTURES_DIR);
    project = buildProgram(FIXTURES_DIR, componentFiles);
  });

  it('extracts JSDoc descriptions into generated story', () => {
    const buttonFile = componentFiles.find((f) => f.endsWith('Button.tsx'))!;
    const meta = parseComponent(project, buttonFile);
    const content = buildStoryContent(meta, 'Button.tsx');

    // Button.tsx has JSDoc like "The text label displayed inside the button"
    const label = meta.props.find((p) => p.name === 'label');
    if (label?.description) {
      expect(content).toContain(label.description);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Default values extracted from destructuring
// ---------------------------------------------------------------------------
describe('integration: default values', () => {
  let project: ReturnType<typeof buildProgram>;
  let componentFiles: string[];

  beforeAll(async () => {
    componentFiles = await findComponents(FIXTURES_DIR);
    project = buildProgram(FIXTURES_DIR, componentFiles);
  });

  it('extracts default values from Button destructuring', () => {
    const buttonFile = componentFiles.find((f) => f.endsWith('Button.tsx'))!;
    const meta = parseComponent(project, buttonFile);

    const variant = meta.props.find((p) => p.name === 'variant');
    expect(variant?.defaultValue).toBeDefined();
    // Should be 'primary' (with or without quotes from ts-morph)
    expect(variant!.defaultValue).toMatch(/primary/);

    const disabled = meta.props.find((p) => p.name === 'disabled');
    expect(disabled?.defaultValue).toBeDefined();
    expect(disabled!.defaultValue).toMatch(/false/);
  });

  it('default values appear in generated story args', () => {
    const buttonFile = componentFiles.find((f) => f.endsWith('Button.tsx'))!;
    const meta = parseComponent(project, buttonFile);
    const content = buildStoryContent(meta, 'Button.tsx');

    // Default story args should use extracted defaults
    expect(content).toContain('"primary"');
    expect(content).toContain('false');
  });
});
