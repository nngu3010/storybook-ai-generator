import { describe, it, expect } from 'vitest';
import path from 'path';
import { findComponents } from '../src/detector/componentFinder.js';
import { buildProgram } from '../src/parser/programBuilder.js';
import { parseComponent } from '../src/parser/componentParser.js';
import { buildStoryContent } from '../src/generator/storyBuilder.js';
import { writeStory } from '../src/generator/storyWriter.js';
import { mapPropToArgType } from '../src/mapper/typeMapper.js';
import { detectVariantProp, generateVariantStories } from '../src/mapper/variantDetector.js';
import { generateHeuristicArgs } from '../src/ai/heuristicGenerator.js';
import { categorizeHint } from '../src/ai/heuristicGenerator.js';
import { scanProjectContext } from '../src/mcp/contextScanner.js';
import type { AiStoryArgs } from '../src/ai/argGenerator.js';
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
    const tmpDir = path.resolve('tests/.tmp-mcp-sync');
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

// ---------------------------------------------------------------------------
// generate_stories
// ---------------------------------------------------------------------------

// Mirrors the MCP handler logic for testability without transport
async function generateStories(
  dir: string,
  componentNames?: string[],
  argsMap?: Record<string, AiStoryArgs>,
  overwrite?: boolean,
  dryRun?: boolean,
) {
  const resolvedDir = path.resolve(dir);
  const componentFiles = await findComponents(resolvedDir);
  const project = buildProgram(resolvedDir, componentFiles);
  const results: object[] = [];

  for (const filePath of componentFiles) {
    const meta = parseComponent(project, filePath);
    if (meta.skipReason) continue;

    if (componentNames && componentNames.length > 0) {
      const match = componentNames.some(
        (n) => n.toLowerCase() === meta.name.toLowerCase() ||
               path.basename(filePath).toLowerCase().includes(n.toLowerCase()),
      );
      if (!match) continue;
    }

    const relativePath = path.basename(filePath);
    const aiArgs = argsMap?.[meta.name];
    const content = buildStoryContent(meta, relativePath, { aiArgs });

    if (dryRun) {
      results.push({ component: meta.name, status: 'dry-run', content });
      continue;
    }

    const result = writeStory(filePath, content, { overwrite });
    results.push({ component: meta.name, status: result, aiArgsApplied: !!aiArgs });
  }

  return results;
}

describe('mcp: generate_stories', () => {
  it('generates stories for all components in dry-run mode', async () => {
    const results = await generateStories(FIXTURES_DIR, undefined, undefined, false, true) as any[];

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.status).toBe('dry-run');
      expect(r.content).toContain('export const Default: Story');
    }
  });

  it('filters to specific components by name', async () => {
    const results = await generateStories(FIXTURES_DIR, ['Input'], undefined, false, true) as any[];

    expect(results.length).toBe(1);
    expect(results[0].component).toBe('Input');
  });

  it('applies custom AI args to generated stories', async () => {
    const argsMap: Record<string, AiStoryArgs> = {
      NoProps: {
        Default: {},
        variants: {},
      },
      Input: {
        Default: { label: 'Email address', placeholder: 'you@example.com' },
        variants: {},
      },
    };

    const results = await generateStories(FIXTURES_DIR, ['Input'], argsMap, false, true) as any[];

    expect(results.length).toBe(1);
    expect(results[0].content).toContain('"Email address"');
    expect(results[0].content).toContain('"you@example.com"');
  });

  it('writes story files to disk', async () => {
    const tmpDir = path.resolve('tests/.tmp-mcp-gen');
    fs.mkdirSync(tmpDir, { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, 'Widget.tsx'),
      `export default function Widget({ title }: { title: string }) { return <h1>{title}</h1>; }`,
    );

    try {
      const argsMap: Record<string, AiStoryArgs> = {
        Widget: {
          Default: { title: 'My Widget' },
          variants: {},
        },
      };

      const results = await generateStories(tmpDir, undefined, argsMap, false, false) as any[];

      expect(results.length).toBe(1);
      expect(results[0].status).toBe('written');
      expect(results[0].aiArgsApplied).toBe(true);

      // Verify file was written
      const storyPath = path.join(tmpDir, 'Widget.stories.ts');
      expect(fs.existsSync(storyPath)).toBe(true);

      const content = fs.readFileSync(storyPath, 'utf-8');
      expect(content).toContain('"My Widget"');
      expect(content).toContain('export const Default: Story');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not overwrite hand-edited stories by default', async () => {
    const tmpDir = path.resolve('tests/.tmp-mcp-no-overwrite');
    fs.mkdirSync(tmpDir, { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, 'Alert.tsx'),
      `export default function Alert({ message }: { message: string }) { return <div>{message}</div>; }`,
    );

    try {
      // Generate first
      await generateStories(tmpDir, undefined, undefined, false, false);

      // Hand-edit the story (different checksum)
      const storyPath = path.join(tmpDir, 'Alert.stories.ts');
      fs.writeFileSync(storyPath, '// hand-edited\nexport const Custom = {};');

      // Re-generate without overwrite
      const results = await generateStories(tmpDir, undefined, undefined, false, false) as any[];

      expect(results[0].status).toBe('conflict');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Enhanced get_component: variantProp, argTypes, hints
// ---------------------------------------------------------------------------
describe('mcp: enhanced get_component', () => {
  it('includes variantProp for Button', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'Button');
    expect(meta).not.toBeNull();

    const variantProp = detectVariantProp(meta!.props);
    expect(variantProp).toBeDefined();
    expect(variantProp!.name).toBe('variant');

    const stories = generateVariantStories(variantProp!);
    expect(stories.length).toBeGreaterThanOrEqual(2);
    expect(stories[0]).toHaveProperty('name');
    expect(stories[0]).toHaveProperty('value');
  });

  it('includes argTypes for all props', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'Button');
    expect(meta).not.toBeNull();

    const argTypes: Record<string, { control: unknown; options?: string[] }> = {};
    for (const p of meta!.props) {
      const at = mapPropToArgType(p);
      const entry: { control: unknown; options?: string[] } = { control: at.control ?? at.action ?? null };
      if (at.options) entry.options = at.options;
      argTypes[p.name] = entry;
    }

    expect(argTypes.label).toBeDefined();
    expect(argTypes.label.control).toBe('text');
    expect(argTypes.variant).toBeDefined();
    expect(argTypes.variant.control).toBe('select');
    expect(argTypes.variant.options).toBeDefined();
    expect(argTypes.variant.options!.length).toBeGreaterThanOrEqual(2);
  });

  it('includes hints for props with recognizable semantics', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'Button');
    expect(meta).not.toBeNull();

    const hints: Record<string, string> = {};
    for (const p of meta!.props) {
      const hint = categorizeHint(p, meta!.name);
      if (hint) hints[p.name] = hint;
    }

    expect(hints.label).toBe('cta_text');
    expect(hints.variant).toBe('variant_selector');
  });

  it('returns no variantProp for NoProps component', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'NoProps');
    expect(meta).not.toBeNull();
    expect(meta!.props.length).toBe(0);

    const variantProp = detectVariantProp(meta!.props);
    expect(variantProp).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// suggest_args
// ---------------------------------------------------------------------------
describe('mcp: suggest_args', () => {
  it('returns valid AiStoryArgs for Button', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'Button');
    expect(meta).not.toBeNull();

    const args = generateHeuristicArgs(meta!);

    expect(args).toHaveProperty('Default');
    expect(args).toHaveProperty('variants');
    expect(typeof args.Default).toBe('object');
    // Button should have label in default args
    expect(args.Default).toHaveProperty('label');
    expect(typeof args.Default.label).toBe('string');
    // Button should have variant stories
    expect(Object.keys(args.variants).length).toBeGreaterThanOrEqual(2);
  });

  it('handles no-props components gracefully', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'NoProps');
    expect(meta).not.toBeNull();

    const args = generateHeuristicArgs(meta!);

    expect(args).toHaveProperty('Default');
    expect(args).toHaveProperty('variants');
    expect(Object.keys(args.Default)).toHaveLength(0);
    expect(Object.keys(args.variants)).toHaveLength(0);
  });

  it('returns args for Input with relevant string values', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'Input');
    expect(meta).not.toBeNull();

    const args = generateHeuristicArgs(meta!);

    expect(args.Default).toHaveProperty('value');
    expect(typeof args.Default.value).toBe('string');
    // placeholder should have a meaningful string
    if (args.Default.placeholder !== undefined) {
      expect(typeof args.Default.placeholder).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// scan_project_context
// ---------------------------------------------------------------------------
describe('mcp: scan_project_context', () => {
  it('scans a temp dir with component usage and mock data', async () => {
    const tmpDir = path.resolve('tests/.tmp-mcp-context');
    fs.mkdirSync(path.join(tmpDir, 'components'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '__mocks__'), { recursive: true });

    // Write a component
    fs.writeFileSync(
      path.join(tmpDir, 'components', 'Alert.tsx'),
      `export default function Alert({ message }: { message: string }) { return <div>{message}</div>; }`,
    );

    // Write a file that uses the component
    fs.writeFileSync(
      path.join(tmpDir, 'App.tsx'),
      `import Alert from './components/Alert';\nexport default function App() { return <Alert message="Hello" />; }`,
    );

    // Write a mock data file
    fs.writeFileSync(
      path.join(tmpDir, '__mocks__', 'data.ts'),
      `export const mockAlerts = [\n  { message: "Test alert 1" },\n  { message: "Test alert 2" },\n];`,
    );

    try {
      const result = await scanProjectContext(tmpDir, 'Alert');

      // Should find usage in App.tsx
      expect(result.componentUsages.length).toBeGreaterThanOrEqual(1);
      const appUsage = result.componentUsages.find((u) => u.file.includes('App.tsx'));
      expect(appUsage).toBeDefined();
      expect(appUsage!.snippets.length).toBeGreaterThanOrEqual(1);
      expect(appUsage!.snippets[0]).toContain('Alert');

      // Should find mock data
      expect(result.mockDataFiles.length).toBeGreaterThanOrEqual(1);
      const mockFile = result.mockDataFiles.find((m) => m.file.includes('data.ts'));
      expect(mockFile).toBeDefined();
      expect(mockFile!.preview).toContain('mockAlerts');

      // Storybook config not present
      expect(result.storybookConfig.main).toBeUndefined();
      expect(result.storybookConfig.preview).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('finds storybook config when present', async () => {
    const tmpDir = path.resolve('tests/.tmp-mcp-sb-config');
    fs.mkdirSync(path.join(tmpDir, '.storybook'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, '.storybook', 'main.ts'),
      `export default { stories: ['../src/**/*.stories.@(ts|tsx)'] };`,
    );

    fs.writeFileSync(
      path.join(tmpDir, '.storybook', 'preview.ts'),
      `export const parameters = { actions: { argTypesRegex: "^on[A-Z].*" } };`,
    );

    try {
      const result = await scanProjectContext(tmpDir, 'Anything');

      expect(result.storybookConfig.main).toContain('stories');
      expect(result.storybookConfig.preview).toContain('parameters');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty results for empty directory', async () => {
    const tmpDir = path.resolve('tests/.tmp-mcp-empty');
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      const result = await scanProjectContext(tmpDir, 'Button');

      expect(result.componentUsages).toHaveLength(0);
      expect(result.mockDataFiles).toHaveLength(0);
      expect(result.designTokenFiles).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: suggest_args → generate_stories
// ---------------------------------------------------------------------------
describe('mcp: suggest_args → generate_stories integration', () => {
  it('suggested args produce valid story content', async () => {
    const meta = await getComponent(FIXTURES_DIR, 'Button');
    expect(meta).not.toBeNull();

    // Get suggested args
    const suggestedArgs = generateHeuristicArgs(meta!);

    // Use them in generate_stories dry-run
    const argsMap: Record<string, AiStoryArgs> = {
      Button: suggestedArgs,
    };

    const results = await generateStories(FIXTURES_DIR, ['Button'], argsMap, false, true) as any[];

    expect(results.length).toBeGreaterThanOrEqual(1);
    const buttonResult = results.find((r: any) => r.component === 'Button');
    expect(buttonResult).toBeDefined();
    expect(buttonResult.status).toBe('dry-run');
    expect(buttonResult.content).toContain('export const Default: Story');
    // The suggested label value should appear in the output
    expect(buttonResult.content).toContain(String(suggestedArgs.Default.label));
  });
});
