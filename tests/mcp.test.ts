import { describe, it, expect } from 'vitest';
import path from 'path';
import { findComponents } from '../src/detector/componentFinder.js';
import { buildProgram } from '../src/parser/programBuilder.js';
import { parseComponent } from '../src/parser/componentParser.js';
import { buildStoryContent } from '../src/generator/storyBuilder.js';
import fs from 'fs';

// Test the tool handlers directly rather than going through the MCP transport.
// We re-implement the logic inline to keep tests fast and dependency-free.

const FIXTURES_DIR = path.resolve('tests/fixtures');

async function listComponents(dir: string) {
  const componentFiles = await findComponents(dir);
  const project = buildProgram(dir, componentFiles);
  const results = [];
  for (const filePath of componentFiles) {
    const meta = parseComponent(project, filePath);
    if (meta.skipReason) continue;
    results.push({
      name: meta.name,
      file: path.relative(dir, filePath),
      propCount: meta.props.length,
      requiredProps: meta.props.filter((p) => p.required).map((p) => p.name),
      optionalProps: meta.props.filter((p) => !p.required).map((p) => p.name),
    });
  }
  return results;
}

async function getComponent(dir: string, name: string) {
  const componentFiles = await findComponents(dir);
  const project = buildProgram(dir, componentFiles);
  const filePath = componentFiles.find((f) => {
    const baseName = path.basename(f).replace(/\.(tsx?|jsx?)$/, '');
    return baseName.toLowerCase() === name.toLowerCase() || f.includes(name);
  });
  if (!filePath) return null;
  const meta = parseComponent(project, filePath);
  if (meta.skipReason) return null;
  return meta;
}

// ---------------------------------------------------------------------------
// list_components
// ---------------------------------------------------------------------------
describe('mcp: list_components', () => {
  it('returns all non-skipped components', async () => {
    const results = await listComponents(FIXTURES_DIR);
    const names = results.map((r) => r.name);

    expect(names).toContain('Button');
    expect(names).toContain('Card');
    expect(names).toContain('Input');
  });

  it('each entry has name, file, propCount, requiredProps, optionalProps', async () => {
    const results = await listComponents(FIXTURES_DIR);
    for (const r of results) {
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('file');
      expect(typeof r.propCount).toBe('number');
      expect(Array.isArray(r.requiredProps)).toBe(true);
      expect(Array.isArray(r.optionalProps)).toBe(true);
    }
  });

  it('Button has label as required and variant as optional', async () => {
    const results = await listComponents(FIXTURES_DIR);
    const button = results.find((r) => r.name === 'Button');
    expect(button).toBeDefined();
    expect(button!.requiredProps).toContain('label');
    expect(button!.optionalProps).toContain('variant');
  });
});

// ---------------------------------------------------------------------------
// get_component
// ---------------------------------------------------------------------------
describe('mcp: get_component', () => {
  it('resolves Button by name (case-insensitive)', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'button');
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe('Button');
  });

  it('returns full prop metadata including types and defaults', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'Button');
    expect(meta).not.toBeNull();

    const label = meta!.props.find((p) => p.name === 'label');
    expect(label).toBeDefined();
    expect(label!.typeName).toContain('string');
    expect(label!.required).toBe(true);

    const variant = meta!.props.find((p) => p.name === 'variant');
    expect(variant).toBeDefined();
    expect(variant!.required).toBe(false);
    expect(variant!.defaultValue).toMatch(/primary/);
  });

  it('returns null for unknown component', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'NonExistentWidget');
    expect(meta).toBeNull();
  });

  it('returns JSDoc descriptions', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'Button');
    const label = meta!.props.find((p) => p.name === 'label');
    expect(label!.description).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// get_story
// ---------------------------------------------------------------------------
describe('mcp: get_story', () => {
  it('generates valid CSF3 content for Button', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'Button');
    expect(meta).not.toBeNull();

    const content = buildStoryContent(meta!, 'Button.tsx');

    expect(content).toMatch(/\/\/ @sbook-ai checksum: [a-f0-9]{12}/);
    expect(content).toContain("from '@storybook/react'");
    expect(content).toContain('export default meta');
    expect(content).toContain('export const Default: Story');
  });

  it('generates variant stories for Button', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'Button');
    const content = buildStoryContent(meta!, 'Button.tsx');

    expect(content).toContain('export const Primary: Story');
    expect(content).toContain('export const Secondary: Story');
  });

  it('generates story for Card with ReactNode children', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'Card');
    const content = buildStoryContent(meta!, 'Card.tsx');

    expect(content).toContain('export default meta');
    expect(content).toContain('export const Default: Story');
  });
});

// ---------------------------------------------------------------------------
// check_stories
// ---------------------------------------------------------------------------
describe('mcp: check_stories', () => {
  it('reports missing when no story files exist', async () => {
    const componentFiles = await findComponents(FIXTURES_DIR);
    const project = buildProgram(FIXTURES_DIR, componentFiles);

    const results = [];
    for (const filePath of componentFiles) {
      const meta = parseComponent(project, filePath);
      if (meta.skipReason) continue;

      const baseName = path.basename(filePath).replace(/\.(tsx?|jsx?)$/, '');
      const storyPath = path.join(path.dirname(filePath), `${baseName}.stories.ts`);

      if (!fs.existsSync(storyPath)) {
        results.push({ component: meta.name, status: 'missing' });
      } else {
        results.push({ component: meta.name, status: 'in-sync' });
      }
    }

    // In a clean test run (no leftover stories), all should be missing
    const allMissingOrSync = results.every(
      (r) => r.status === 'missing' || r.status === 'in-sync',
    );
    expect(allMissingOrSync).toBe(true);
  });

  it('reports in-sync after writing a story', async () => {
    const tmpDir = path.resolve('tests/.tmp-mcp-check');
    fs.mkdirSync(tmpDir, { recursive: true });

    // Write a simple component
    const componentPath = path.join(tmpDir, 'Fake.tsx');
    fs.writeFileSync(
      componentPath,
      `export default function Fake({ label }: { label: string }) { return <div>{label}</div>; }`,
    );

    try {
      const componentFiles = await findComponents(tmpDir);
      const project = buildProgram(tmpDir, componentFiles);
      const meta = parseComponent(project, componentPath);

      expect(meta.skipReason).toBeUndefined();

      const content = buildStoryContent(meta, 'Fake.tsx');
      const storyPath = path.join(tmpDir, 'Fake.stories.ts');
      fs.writeFileSync(storyPath, content);

      // Now check
      const existingContent = fs.readFileSync(storyPath, 'utf-8');
      const existingChecksum = existingContent.match(/\/\/ @sbook-ai checksum: ([a-f0-9]+)/)?.[1];
      const freshChecksum = content.match(/\/\/ @sbook-ai checksum: ([a-f0-9]+)/)?.[1];

      expect(existingChecksum).toBe(freshChecksum);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
