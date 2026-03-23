import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { computeStoryPath, computeImportPath, writeStory } from '../src/generator/storyWriter.js';
import { buildStoryContent } from '../src/generator/storyBuilder.js';
import { buildProgram } from '../src/parser/programBuilder.js';
import { parseComponent } from '../src/parser/componentParser.js';
import { findComponents } from '../src/detector/componentFinder.js';

// ---------------------------------------------------------------------------
// Unit tests: path computation helpers
// ---------------------------------------------------------------------------

describe('computeStoryPath', () => {
  const scanDir = '/project/src';

  it('returns co-located path when no outputDir', () => {
    const result = computeStoryPath('/project/src/components/Button.tsx', scanDir);
    expect(result).toBe('/project/src/components/Button.stories.ts');
  });

  it('mirrors source structure under outputDir', () => {
    const result = computeStoryPath(
      '/project/src/components/Button.tsx',
      scanDir,
      '/project/.stories',
    );
    expect(result).toBe('/project/.stories/components/Button.stories.ts');
  });

  it('handles nested component paths', () => {
    const result = computeStoryPath(
      '/project/src/components/forms/Input.tsx',
      scanDir,
      '/project/.stories',
    );
    expect(result).toBe('/project/.stories/components/forms/Input.stories.ts');
  });

  it('handles component at scan root', () => {
    const result = computeStoryPath(
      '/project/src/App.tsx',
      scanDir,
      '/project/.stories',
    );
    expect(result).toBe('/project/.stories/App.stories.ts');
  });

  it('strips .jsx extension', () => {
    const result = computeStoryPath(
      '/project/src/Card.jsx',
      scanDir,
      '/project/.stories',
    );
    expect(result).toBe('/project/.stories/Card.stories.ts');
  });
});

describe('computeImportPath', () => {
  it('returns ./ComponentName for co-located stories', () => {
    const result = computeImportPath(
      '/project/src/components/Button.stories.ts',
      '/project/src/components/Button.tsx',
    );
    expect(result).toBe('./Button');
  });

  it('returns relative path back to source for output-dir stories', () => {
    const result = computeImportPath(
      '/project/.stories/components/Button.stories.ts',
      '/project/src/components/Button.tsx',
    );
    // From .stories/components/ back to src/components/
    expect(result).toBe('../../src/components/Button');
  });

  it('handles deeply nested components', () => {
    const result = computeImportPath(
      '/project/.stories/components/forms/Input.stories.ts',
      '/project/src/components/forms/Input.tsx',
    );
    expect(result).toBe('../../../src/components/forms/Input');
  });

  it('handles component at root level', () => {
    const result = computeImportPath(
      '/project/.stories/App.stories.ts',
      '/project/src/App.tsx',
    );
    expect(result).toBe('../src/App');
  });
});

// ---------------------------------------------------------------------------
// Integration tests: writeStory with outputPath
// ---------------------------------------------------------------------------

describe('writeStory with outputPath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbook-output-dir-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates directories and writes story to outputPath', () => {
    const outputPath = path.join(tmpDir, 'components', 'Button.stories.ts');
    const content = '// @sbook-ai checksum: abc123 generated: 2025-01-01\nexport default {};';

    const result = writeStory('/fake/Button.tsx', content, { outputPath });

    expect(result).toBe('written');
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.readFileSync(outputPath, 'utf-8')).toBe(content);
  });

  it('skips when checksum matches at outputPath', () => {
    const outputPath = path.join(tmpDir, 'Button.stories.ts');
    const content = '// @sbook-ai checksum: abc123 generated: 2025-01-01\nexport default {};';

    // Write first time
    fs.writeFileSync(outputPath, content);

    // Should skip on second write
    const result = writeStory('/fake/Button.tsx', content, { outputPath });
    expect(result).toBe('skipped');
  });

  it('writes conflict file at outputPath location', () => {
    const outputPath = path.join(tmpDir, 'Button.stories.ts');
    const existing = '// @sbook-ai checksum: old123 generated: 2025-01-01\nexport default {};';
    const updated = '// @sbook-ai checksum: new456 generated: 2025-01-01\nexport default {};';

    fs.writeFileSync(outputPath, existing);

    const result = writeStory('/fake/Button.tsx', updated, { outputPath });
    expect(result).toBe('conflict');
    expect(fs.existsSync(path.join(tmpDir, 'Button.stories.generated.ts'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: generate pipeline with outputDir
// ---------------------------------------------------------------------------

describe('generate pipeline with outputDir', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');
  let tmpOutputDir: string;

  beforeEach(() => {
    tmpOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbook-e2e-output-'));
  });

  afterEach(() => {
    fs.rmSync(tmpOutputDir, { recursive: true, force: true });
  });

  it('generates stories in output dir with correct import paths', async () => {
    const componentFiles = await findComponents(fixturesDir);
    const project = buildProgram(fixturesDir, componentFiles);

    // Pick the first parseable component
    let found = false;
    for (const filePath of componentFiles) {
      const meta = parseComponent(project, filePath);
      if (meta.skipReason) continue;

      const storyPath = computeStoryPath(filePath, fixturesDir, tmpOutputDir);
      const importRelPath = computeImportPath(storyPath, filePath);
      const content = buildStoryContent(meta, importRelPath);

      const result = writeStory(filePath, content, { outputPath: storyPath });

      expect(result).toBe('written');
      expect(fs.existsSync(storyPath)).toBe(true);

      // Verify the import path resolves back to the component
      const storyContent = fs.readFileSync(storyPath, 'utf-8');
      expect(storyContent).toContain(`import ${meta.name} from '`);

      // The import should be a relative path going up from output dir to fixtures
      const importMatch = storyContent.match(/import \w+ from '([^']+)'/);
      expect(importMatch).toBeTruthy();
      const resolvedImport = path.resolve(path.dirname(storyPath), importMatch![1]);
      // Should resolve to the component file (minus extension)
      expect(resolvedImport).toBe(filePath.replace(/\.(tsx?|jsx?)$/, ''));

      found = true;
      break;
    }

    expect(found).toBe(true);
  });

  it('mirrors directory structure from scan dir', async () => {
    const componentFiles = await findComponents(fixturesDir);
    const project = buildProgram(fixturesDir, componentFiles);

    for (const filePath of componentFiles) {
      const meta = parseComponent(project, filePath);
      if (meta.skipReason) continue;

      const storyPath = computeStoryPath(filePath, fixturesDir, tmpOutputDir);
      const importRelPath = computeImportPath(storyPath, filePath);
      const content = buildStoryContent(meta, importRelPath);
      writeStory(filePath, content, { outputPath: storyPath });

      // Story path should be relative to outputDir in the same way component is relative to fixturesDir
      const relFromScan = path.relative(fixturesDir, filePath);
      const relFromOutput = path.relative(tmpOutputDir, storyPath);
      expect(path.dirname(relFromOutput)).toBe(path.dirname(relFromScan));
    }
  });
});
