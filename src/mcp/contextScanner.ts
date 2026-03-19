import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

export interface ProjectContext {
  componentUsages: Array<{ file: string; snippets: string[] }>;
  mockDataFiles: Array<{ file: string; preview: string }>;
  designTokenFiles: Array<{ file: string; preview: string }>;
  storybookConfig: { main?: string; preview?: string };
}

const MAX_USAGE_FILES = 5;
const MAX_USAGES_PER_FILE = 3;
const MAX_MOCK_FILES = 5;
const MAX_MOCK_LINES = 50;
const MAX_TOKEN_FILES = 3;
const MAX_TOKEN_LINES = 30;
const MAX_OUTPUT_CHARS = 4000;

/**
 * Scans a project directory for contextual information about a component:
 * - Where the component is imported and rendered (JSX snippets)
 * - Mock/fixture data files
 * - Design token files (theme, colors)
 * - Storybook config files
 */
export async function scanProjectContext(
  dir: string,
  componentName: string,
): Promise<ProjectContext> {
  const [usages, mockFiles, tokenFiles, sbConfig] = await Promise.all([
    findComponentUsages(dir, componentName),
    findMockDataFiles(dir),
    findDesignTokenFiles(dir),
    findStorybookConfig(dir),
  ]);

  const result: ProjectContext = {
    componentUsages: usages,
    mockDataFiles: mockFiles,
    designTokenFiles: tokenFiles,
    storybookConfig: sbConfig,
  };

  // Truncate if output exceeds limit
  return truncateResult(result);
}

// ---------------------------------------------------------------------------
// Component usages
// ---------------------------------------------------------------------------

async function findComponentUsages(
  dir: string,
  componentName: string,
): Promise<Array<{ file: string; snippets: string[] }>> {
  const allFiles = await glob('**/*.{tsx,jsx}', {
    cwd: dir,
    ignore: ['**/node_modules/**', '**/*.stories.*', '**/*.test.*', '**/*.spec.*'],
    absolute: true,
  });

  const results: Array<{ file: string; snippets: string[] }> = [];

  for (const filePath of allFiles) {
    if (results.length >= MAX_USAGE_FILES) break;

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    // Check if file imports the component
    const importPattern = new RegExp(
      `import\\s+.*\\b${escapeRegExp(componentName)}\\b.*from\\s+`,
    );
    if (!importPattern.test(content)) continue;

    // Find JSX usages: <ComponentName ... />  or  <ComponentName ...>
    const jsxPattern = new RegExp(
      `<${escapeRegExp(componentName)}[\\s/>][^]*?(?:/>|</${escapeRegExp(componentName)}>)`,
      'g',
    );
    const snippets: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = jsxPattern.exec(content)) !== null && snippets.length < MAX_USAGES_PER_FILE) {
      // Cap each snippet at 300 chars
      const snippet = match[0].length > 300 ? match[0].slice(0, 300) + '...' : match[0];
      snippets.push(snippet);
    }

    if (snippets.length > 0) {
      results.push({ file: path.relative(dir, filePath), snippets });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Mock data files
// ---------------------------------------------------------------------------

async function findMockDataFiles(
  dir: string,
): Promise<Array<{ file: string; preview: string }>> {
  const patterns = [
    '**/mock*',
    '**/fixture*',
    '**/seed*',
    '**/__mocks__/**',
  ];

  const results: Array<{ file: string; preview: string }> = [];

  for (const pattern of patterns) {
    if (results.length >= MAX_MOCK_FILES) break;

    const files = await glob(pattern, {
      cwd: dir,
      ignore: ['**/node_modules/**'],
      absolute: true,
      nodir: true,
    });

    for (const filePath of files) {
      if (results.length >= MAX_MOCK_FILES) break;
      // Only read text-like files
      if (!/\.(ts|tsx|js|jsx|json)$/.test(filePath)) continue;

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').slice(0, MAX_MOCK_LINES);
        results.push({ file: path.relative(dir, filePath), preview: lines.join('\n') });
      } catch {
        continue;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Design token files
// ---------------------------------------------------------------------------

async function findDesignTokenFiles(
  dir: string,
): Promise<Array<{ file: string; preview: string }>> {
  const patterns = [
    '**/theme*',
    '**/tokens*',
    '**/colors*',
  ];

  const results: Array<{ file: string; preview: string }> = [];

  for (const pattern of patterns) {
    if (results.length >= MAX_TOKEN_FILES) break;

    const files = await glob(pattern, {
      cwd: dir,
      ignore: ['**/node_modules/**'],
      absolute: true,
      nodir: true,
    });

    for (const filePath of files) {
      if (results.length >= MAX_TOKEN_FILES) break;
      if (!/\.(ts|tsx|js|jsx|json|css|scss)$/.test(filePath)) continue;

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').slice(0, MAX_TOKEN_LINES);
        results.push({ file: path.relative(dir, filePath), preview: lines.join('\n') });
      } catch {
        continue;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Storybook config
// ---------------------------------------------------------------------------

async function findStorybookConfig(
  dir: string,
): Promise<{ main?: string; preview?: string }> {
  const config: { main?: string; preview?: string } = {};

  const mainCandidates = [
    '.storybook/main.ts',
    '.storybook/main.js',
    '.storybook/main.tsx',
  ];
  const previewCandidates = [
    '.storybook/preview.ts',
    '.storybook/preview.js',
    '.storybook/preview.tsx',
  ];

  for (const candidate of mainCandidates) {
    const fullPath = path.join(dir, candidate);
    if (fs.existsSync(fullPath)) {
      try {
        config.main = fs.readFileSync(fullPath, 'utf-8');
      } catch { /* skip */ }
      break;
    }
  }

  for (const candidate of previewCandidates) {
    const fullPath = path.join(dir, candidate);
    if (fs.existsSync(fullPath)) {
      try {
        config.preview = fs.readFileSync(fullPath, 'utf-8');
      } catch { /* skip */ }
      break;
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncateResult(result: ProjectContext): ProjectContext {
  const serialized = JSON.stringify(result);
  if (serialized.length <= MAX_OUTPUT_CHARS) return result;

  // Progressively trim to fit within budget
  // First, trim mock data previews
  for (const mock of result.mockDataFiles) {
    const lines = mock.preview.split('\n');
    mock.preview = lines.slice(0, Math.ceil(lines.length / 2)).join('\n') + '\n...';
  }

  if (JSON.stringify(result).length <= MAX_OUTPUT_CHARS) return result;

  // Then trim token file previews
  for (const token of result.designTokenFiles) {
    const lines = token.preview.split('\n');
    token.preview = lines.slice(0, Math.ceil(lines.length / 2)).join('\n') + '\n...';
  }

  if (JSON.stringify(result).length <= MAX_OUTPUT_CHARS) return result;

  // Finally, trim usage snippets
  for (const usage of result.componentUsages) {
    usage.snippets = usage.snippets.slice(0, 1);
  }

  return result;
}
