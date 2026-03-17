import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { findComponents } from '../src/detector/componentFinder.js';
import { buildProgram } from '../src/parser/programBuilder.js';
import { parseComponent } from '../src/parser/componentParser.js';
import { buildStoryContent } from '../src/generator/storyBuilder.js';
import { writeStory } from '../src/generator/storyWriter.js';

const FIXTURES_DIR = path.resolve('tests/fixtures');
const generatedStories: string[] = [];

describe('e2e: full generate pipeline', () => {
  beforeAll(async () => {
    // Clean any existing stories in fixtures
    const existing = fs.readdirSync(FIXTURES_DIR).filter((f) => f.includes('.stories.'));
    for (const f of existing) {
      fs.unlinkSync(path.join(FIXTURES_DIR, f));
    }

    // Run full pipeline
    const componentFiles = await findComponents(FIXTURES_DIR);
    const project = buildProgram(FIXTURES_DIR, componentFiles);

    for (const filePath of componentFiles) {
      const meta = parseComponent(project, filePath);
      if (meta.skipReason) continue;

      const content = buildStoryContent(meta, path.basename(filePath));
      const result = writeStory(filePath, content, { overwrite: true });

      if (result === 'written' || result === 'conflict') {
        const storyPath = path.join(
          path.dirname(filePath),
          `${path.basename(filePath).replace(/\.(tsx?|jsx?)$/, '')}.stories.ts`
        );
        generatedStories.push(storyPath);
      }
    }
  });

  afterAll(() => {
    // Clean up generated stories
    for (const f of generatedStories) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    // Also clean up any .generated.ts files
    const remaining = fs.readdirSync(FIXTURES_DIR).filter((f) => f.includes('.stories.'));
    for (const f of remaining) {
      fs.unlinkSync(path.join(FIXTURES_DIR, f));
    }
  });

  it('generates story files for all non-skipped components', () => {
    expect(generatedStories.length).toBeGreaterThanOrEqual(4);

    for (const storyPath of generatedStories) {
      expect(fs.existsSync(storyPath)).toBe(true);
    }
  });

  it('every generated story has valid structure', () => {
    for (const storyPath of generatedStories) {
      const content = fs.readFileSync(storyPath, 'utf-8');

      // Checksum header
      expect(content).toMatch(/\/\/ @sbook-ai checksum: [a-f0-9]{12}/);

      // Required imports
      expect(content).toContain("from '@storybook/react'");

      // Meta export
      expect(content).toContain('export default meta');

      // At least a Default story
      expect(content).toContain('export const Default: Story');

      // No duplicate export names
      const exports = content.match(/export const (\w+):/g) ?? [];
      const names = exports.map((e) => e.match(/export const (\w+)/)![1]);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('re-running generation skips unchanged components', async () => {
    const componentFiles = await findComponents(FIXTURES_DIR);
    const project = buildProgram(FIXTURES_DIR, componentFiles);

    let skipped = 0;
    for (const filePath of componentFiles) {
      const meta = parseComponent(project, filePath);
      if (meta.skipReason) continue;

      const content = buildStoryContent(meta, path.basename(filePath));
      const result = writeStory(filePath, content);
      if (result === 'skipped') skipped++;
    }

    // All should be skipped since nothing changed
    expect(skipped).toBe(generatedStories.length);
  });

  it('generated stories contain no syntax errors (parseable JS)', () => {
    for (const storyPath of generatedStories) {
      const content = fs.readFileSync(storyPath, 'utf-8');

      // Strip TypeScript-only syntax for basic JS parse check
      const jsContent = content
        .replace(/import type\s+\{[^}]+\}\s+from\s+'[^']+';/g, '')
        .replace(/type Story = StoryObj<[^>]+>;/g, '')
        .replace(/:\s*Meta<typeof \w+>/g, '')
        .replace(/:\s*Story/g, '')
        .replace(/satisfies\s+\w+<[^>]+>/g, '');

      // Should not throw
      expect(() => {
        // Basic check: all braces/brackets are balanced
        let depth = 0;
        for (const ch of jsContent) {
          if (ch === '{' || ch === '[' || ch === '(') depth++;
          if (ch === '}' || ch === ']' || ch === ')') depth--;
          if (depth < 0) throw new Error('Unbalanced brackets');
        }
        if (depth !== 0) throw new Error(`Unbalanced brackets: depth=${depth}`);
      }).not.toThrow();
    }
  });

  it('variant stories have correct prop overrides', () => {
    const buttonStory = generatedStories.find((f) => f.includes('Button'));
    if (!buttonStory) return;

    const content = fs.readFileSync(buttonStory, 'utf-8');

    // Each variant story should set the variant prop to its specific value
    if (content.includes('export const Primary')) {
      expect(content).toMatch(/Primary.*variant:\s*'primary'/s);
    }
    if (content.includes('export const Secondary')) {
      expect(content).toMatch(/Secondary.*variant:\s*'secondary'/s);
    }
    if (content.includes('export const Danger')) {
      expect(content).toMatch(/Danger.*variant:\s*'danger'/s);
    }
  });
});

describe('e2e: TypeScript validation of generated stories', () => {
  const tmpDir = path.resolve('tests/.tmp-typecheck');

  beforeAll(async () => {
    // Create a temporary directory with a component + generated story
    fs.mkdirSync(tmpDir, { recursive: true });

    // Write a minimal tsconfig pointing to the project's node_modules for React types
    const rootDir = path.resolve('.');
    fs.writeFileSync(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          typeRoots: [path.join(rootDir, 'node_modules', '@types')],
          paths: {
            'react': [path.join(rootDir, 'node_modules', '@types', 'react')],
            'react/jsx-runtime': [path.join(rootDir, 'node_modules', '@types', 'react', 'jsx-runtime')],
          },
          baseUrl: '.',
        },
        include: ['*.ts', '*.tsx'],
      })
    );

    // Write storybook type stubs so TypeScript doesn't complain about missing module
    fs.writeFileSync(
      path.join(tmpDir, 'storybook.d.ts'),
      `declare module '@storybook/react' {
  export type Meta<T = any> = {
    title?: string;
    component?: T;
    tags?: string[];
    argTypes?: Record<string, any>;
    decorators?: any[];
  };
  export type StoryObj<T = any> = {
    args?: Record<string, any>;
    play?: (context: any) => Promise<void>;
  };
}`
    );

    // Copy Button fixture
    fs.copyFileSync(
      path.join(FIXTURES_DIR, 'Button.tsx'),
      path.join(tmpDir, 'Button.tsx')
    );

    // Generate its story
    const componentFiles = [path.join(tmpDir, 'Button.tsx')];
    const project = buildProgram(tmpDir, componentFiles);
    const meta = parseComponent(project, componentFiles[0]);
    const content = buildStoryContent(meta, 'Button.tsx');
    fs.writeFileSync(path.join(tmpDir, 'Button.stories.ts'), content);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generated story typechecks with tsc --noEmit', () => {
    try {
      execSync(`npx tsc --noEmit --project ${path.join(tmpDir, 'tsconfig.json')}`, {
        cwd: tmpDir,
        stdio: 'pipe',
        timeout: 30000,
      });
    } catch (err: any) {
      const stderr = err.stderr?.toString() ?? '';
      const stdout = err.stdout?.toString() ?? '';
      // Fail the test with the TypeScript error output
      expect.fail(`TypeScript errors in generated story:\n${stdout}\n${stderr}`);
    }
  });
});
