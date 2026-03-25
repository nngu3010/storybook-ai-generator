import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { writeStory } from '../src/generator/storyWriter.js';
import { buildStoryContent } from '../src/generator/storyBuilder.js';
import type { ComponentMeta } from '../src/parser/componentParser.js';

// ---------------------------------------------------------------------------
// Fix 1: --overwrite should force regeneration even when checksum matches
// ---------------------------------------------------------------------------

describe('overwrite bypasses checksum match', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbook-overwrite-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips when checksum matches and overwrite is false', () => {
    const outputPath = path.join(tmpDir, 'Button.stories.ts');
    const content = '// @sbook-ai checksum: abc123 generated: 2025-01-01\nexport default {};';
    fs.writeFileSync(outputPath, content);

    const result = writeStory('/fake/Button.tsx', content, { outputPath });
    expect(result).toBe('skipped');
  });

  it('overwrites when checksum matches and overwrite is true', () => {
    const outputPath = path.join(tmpDir, 'Button.stories.ts');
    const content = '// @sbook-ai checksum: abc123 generated: 2025-01-01\nexport default {};';
    fs.writeFileSync(outputPath, content);

    const newContent = '// @sbook-ai checksum: abc123 generated: 2026-03-23\nexport default { updated: true };';
    const result = writeStory('/fake/Button.tsx', newContent, { outputPath, overwrite: true });
    expect(result).toBe('written');
    expect(fs.readFileSync(outputPath, 'utf-8')).toBe(newContent);
  });
});

// ---------------------------------------------------------------------------
// Fix 2: Custom args.variants should always be emitted
// ---------------------------------------------------------------------------

describe('custom variant args emitted without variant prop', () => {
  const meta: ComponentMeta = {
    name: 'Badge',
    filePath: '/src/components/Badge.tsx',
    props: [
      { name: 'label', typeName: 'string', required: true },
      { name: 'color', typeName: 'string', required: false },
    ],
  };

  it('emits custom variant stories when no variant prop is detected', () => {
    const content = buildStoryContent(meta, './Badge', {
      aiArgs: {
        Default: { label: 'Active', color: 'green' },
        variants: {
          Warning: { label: 'Pending', color: 'yellow' },
          Error: { label: 'Failed', color: 'red' },
        },
      },
    });

    expect(content).toContain('export const Default: Story');
    expect(content).toContain('export const Warning: Story');
    expect(content).toContain('export const Error: Story');
    expect(content).toContain('"Pending"');
    expect(content).toContain('"Failed"');
  });

  it('does not duplicate variants already emitted by variant prop detection', () => {
    const metaWithVariant: ComponentMeta = {
      name: 'Button',
      filePath: '/src/components/Button.tsx',
      props: [
        { name: 'label', typeName: 'string', required: true },
        { name: 'variant', typeName: "'primary' | 'secondary'", required: false },
      ],
    };

    const content = buildStoryContent(metaWithVariant, './Button', {
      aiArgs: {
        Default: { label: 'Click me', variant: 'primary' },
        variants: {
          Primary: { label: 'Save', variant: 'primary' },
          Secondary: { label: 'Cancel', variant: 'secondary' },
          Custom: { label: 'Extra', variant: 'primary' },
        },
      },
    });

    // Primary and Secondary come from variant prop detection
    expect(content).toContain('export const Primary: Story');
    expect(content).toContain('export const Secondary: Story');
    // Custom should also be emitted (not in variant prop values)
    expect(content).toContain('export const Custom: Story');

    // Primary should appear exactly once (not duplicated)
    const primaryCount = (content.match(/export const Primary: Story/g) ?? []).length;
    expect(primaryCount).toBe(1);
  });

  it('emits no extra variants when aiArgs has no variants', () => {
    const content = buildStoryContent(meta, './Badge', {
      aiArgs: {
        Default: { label: 'Active' },
        variants: {},
      },
    });

    expect(content).toContain('export const Default: Story');
    // Only Default, no extra variant stories
    const storyExports = (content.match(/export const \w+: Story/g) ?? []);
    expect(storyExports).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Fix 3: MCP generate_stories ai parameter (compile-time check)
// ---------------------------------------------------------------------------

describe('MCP generate_stories ai parameter', () => {
  it('tool definition includes ai boolean parameter', async () => {
    // Dynamically import to get the TOOLS array via the module
    // We verify the tool schema includes the ai param
    const serverModule = await import('../src/mcp/server.js');
    // The TOOLS const is not exported, so we verify via the built server behavior
    // Instead, just verify the source includes the parameter (compile-time correctness)
    const serverSource = fs.readFileSync(
      path.resolve('src/mcp/server.ts'),
      'utf-8',
    );

    // Extract the generate_stories tool definition block
    const startIdx = serverSource.indexOf("name: 'generate_stories'");
    const endIdx = serverSource.indexOf("required: ['dir']", startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const toolSection = serverSource.slice(startIdx, endIdx + 30);
    expect(toolSection).toContain('ai:');
    expect(toolSection).toContain("type: 'boolean'");
  });
});
