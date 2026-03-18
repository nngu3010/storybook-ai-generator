import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectProviders } from '../src/decorators/providerDetector.js';
import { generatePreviewContent } from '../src/decorators/previewGenerator.js';

// ---------------------------------------------------------------------------
// Helper: create a temp project dir with a given package.json
// ---------------------------------------------------------------------------
function makeTempProject(deps: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbook-decorators-'));
  const pkg = { name: 'test-project', dependencies: deps };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}

// ---------------------------------------------------------------------------
// detectProviders
// ---------------------------------------------------------------------------
describe('detectProviders', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no providers are detected', () => {
    tmpDir = makeTempProject({ react: '^18.0.0', 'date-fns': '^3.0.0' });
    const result = detectProviders(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns empty array when package.json does not exist', () => {
    const dir = path.join(os.tmpdir(), 'nonexistent-' + Date.now());
    const result = detectProviders(dir);
    expect(result).toEqual([]);
  });

  it('detects react-redux', () => {
    tmpDir = makeTempProject({ 'react-redux': '^9.0.0' });
    const result = detectProviders(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Redux');
    expect(result[0].library).toBe('react-redux');
    expect(result[0].companionFile).toBeDefined();
    expect(result[0].companionFile!.filename).toBe('mockStore.ts');
  });

  it('detects @reduxjs/toolkit and deduplicates with react-redux', () => {
    tmpDir = makeTempProject({
      'react-redux': '^9.0.0',
      '@reduxjs/toolkit': '^2.0.0',
    });
    const result = detectProviders(tmpDir);
    // Should only have one Redux entry, not two
    const reduxProviders = result.filter((p) => p.label.startsWith('Redux'));
    expect(reduxProviders).toHaveLength(1);
  });

  it('detects jotai', () => {
    tmpDir = makeTempProject({ jotai: '^2.0.0' });
    const result = detectProviders(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Jotai');
    expect(result[0].wrapper).toContain('JotaiProvider');
  });

  it('detects recoil', () => {
    tmpDir = makeTempProject({ recoil: '^0.7.0' });
    const result = detectProviders(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Recoil');
    expect(result[0].wrapper).toContain('RecoilRoot');
  });

  it('detects react-query', () => {
    tmpDir = makeTempProject({ '@tanstack/react-query': '^5.0.0' });
    const result = detectProviders(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('React Query');
    expect(result[0].wrapper).toContain('QueryClientProvider');
  });

  it('detects react-router-dom', () => {
    tmpDir = makeTempProject({ 'react-router-dom': '^6.0.0' });
    const result = detectProviders(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('React Router');
    expect(result[0].wrapper).toContain('MemoryRouter');
  });

  it('skips zustand (no provider needed)', () => {
    tmpDir = makeTempProject({ zustand: '^4.0.0' });
    const result = detectProviders(tmpDir);
    expect(result).toHaveLength(0);
  });

  it('detects styled-components theme provider', () => {
    tmpDir = makeTempProject({ 'styled-components': '^6.0.0' });
    const result = detectProviders(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('styled-components');
    expect(result[0].companionFile).toBeDefined();
  });

  it('detects MUI theme provider', () => {
    tmpDir = makeTempProject({ '@mui/material': '^5.0.0' });
    const result = detectProviders(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('MUI');
  });

  it('detects react-intl', () => {
    tmpDir = makeTempProject({ 'react-intl': '^6.0.0' });
    const result = detectProviders(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('React Intl');
    expect(result[0].wrapper).toContain('IntlProvider');
  });

  it('detects multiple providers at once', () => {
    tmpDir = makeTempProject({
      'react-redux': '^9.0.0',
      'react-router-dom': '^6.0.0',
      '@tanstack/react-query': '^5.0.0',
    });
    const result = detectProviders(tmpDir);
    expect(result).toHaveLength(3);
    const labels = result.map((p) => p.label).sort();
    expect(labels).toEqual(['React Query', 'React Router', 'Redux']);
  });

  it('reads from devDependencies too', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbook-decorators-'));
    const pkg = { name: 'test', devDependencies: { jotai: '^2.0.0' } };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));
    const result = detectProviders(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Jotai');
  });
});

// ---------------------------------------------------------------------------
// generatePreviewContent
// ---------------------------------------------------------------------------
describe('generatePreviewContent', () => {
  it('generates valid preview with single provider', () => {
    const providers = detectProviders(
      createTempWithDeps({ jotai: '^2.0.0' }),
    );
    const content = generatePreviewContent(providers);

    expect(content).toContain("import type { Preview } from '@storybook/react'");
    expect(content).toContain("import { Provider as JotaiProvider } from 'jotai'");
    expect(content).toContain('<JotaiProvider>');
    expect(content).toContain('<Story />');
    expect(content).toContain('</JotaiProvider>');
    expect(content).toContain('export default preview');
  });

  it('nests multiple providers correctly', () => {
    const providers = detectProviders(
      createTempWithDeps({
        'react-redux': '^9.0.0',
        'react-router-dom': '^6.0.0',
      }),
    );
    const content = generatePreviewContent(providers);

    // Both providers should appear
    expect(content).toContain('ReduxProvider');
    expect(content).toContain('MemoryRouter');
    expect(content).toContain('<Story />');

    // Verify nesting order: outer providers come first in the source
    const reduxIdx = content.indexOf('<ReduxProvider');
    const routerIdx = content.indexOf('<MemoryRouter');
    const storyIdx = content.indexOf('<Story />');
    expect(reduxIdx).toBeLessThan(routerIdx);
    expect(routerIdx).toBeLessThan(storyIdx);
  });

  it('includes parameter matchers', () => {
    const providers = detectProviders(
      createTempWithDeps({ recoil: '^0.7.0' }),
    );
    const content = generatePreviewContent(providers);
    expect(content).toContain('color: /(background|color)$/i');
    expect(content).toContain('date: /Date$/i');
  });

  it('includes auto-generated comment header', () => {
    const providers = detectProviders(
      createTempWithDeps({ jotai: '^2.0.0' }),
    );
    const content = generatePreviewContent(providers);
    expect(content).toContain('Auto-generated by sbook-ai');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
  tempDirs.length = 0;
});

function createTempWithDeps(deps: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbook-preview-'));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test', dependencies: deps }));
  return dir;
}
