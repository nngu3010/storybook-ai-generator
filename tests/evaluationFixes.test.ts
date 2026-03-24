import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildStoryContent } from '../src/generator/storyBuilder.js';
import { isAsyncServerComponent } from '../src/detector/heuristics.js';
import { scanLayoutProviders } from '../src/decorators/layoutScanner.js';
import type { ComponentMeta } from '../src/parser/componentParser.js';

// ---------------------------------------------------------------------------
// Bug fix 1: Variant "default" should not produce duplicate Default export
// ---------------------------------------------------------------------------
describe('duplicate Default export from variant "default"', () => {
  const meta: ComponentMeta = {
    name: 'Button',
    filePath: '/src/components/Button.tsx',
    props: [
      { name: 'label', typeName: 'string', required: true },
      { name: 'variant', typeName: "'default' | 'primary' | 'danger'", required: false },
    ],
  };

  it('does not produce duplicate export const Default', () => {
    const content = buildStoryContent(meta, './Button');
    const defaultExports = (content.match(/export const Default: Story/g) ?? []);
    expect(defaultExports).toHaveLength(1);
  });

  it('still emits other variant stories', () => {
    const content = buildStoryContent(meta, './Button');
    expect(content).toContain('export const Primary: Story');
    expect(content).toContain('export const Danger: Story');
  });

  it('handles mixed-case "Default" variant from capitalisation', () => {
    const metaMixed: ComponentMeta = {
      name: 'Tag',
      filePath: '/src/components/Tag.tsx',
      props: [
        { name: 'size', typeName: "'default' | 'small' | 'large'", required: false },
      ],
    };

    const content = buildStoryContent(metaMixed, './Tag');
    const defaultExports = (content.match(/export const Default: Story/g) ?? []);
    expect(defaultExports).toHaveLength(1);
    expect(content).toContain('export const Small: Story');
    expect(content).toContain('export const Large: Story');
  });
});

// ---------------------------------------------------------------------------
// Bug fix 2: Async server component detection edge cases
// ---------------------------------------------------------------------------
describe('async server component detection — edge cases', () => {
  it('detects async() without space after async keyword', () => {
    const content = `
      const ProductHeader = async() => {
        const data = await fetch('/api/product');
        return <div>{data}</div>;
      };
      export default ProductHeader;
    `;
    expect(isAsyncServerComponent(content)).toBe(true);
  });

  it('detects export { Name as default } pattern', () => {
    const content = `
      const DataFetcher = async () => {
        const data = await fetch('/api');
        return <div>{data}</div>;
      };
      export { DataFetcher as default };
    `;
    expect(isAsyncServerComponent(content)).toBe(true);
  });

  it('detects export async function Name() with separate export default', () => {
    const content = `
      export async function ServicePage() {
        const service = await fetchService();
        return <div>{service}</div>;
      }
      export default ServicePage;
    `;
    expect(isAsyncServerComponent(content)).toBe(true);
  });

  it('detects export async function with export { as default }', () => {
    const content = `
      export async function CatalogPage() {
        const items = await fetchItems();
        return <ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>;
      }
      export { CatalogPage as default };
    `;
    expect(isAsyncServerComponent(content)).toBe(true);
  });

  it('does NOT flag sync export async function without default export', () => {
    const content = `
      export async function fetchData() {
        return await fetch('/api');
      }
      export default function Page() {
        return <div />;
      }
    `;
    expect(isAsyncServerComponent(content)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Feature: Layout provider scanning
// ---------------------------------------------------------------------------
describe('scanLayoutProviders', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbook-layout-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects custom providers from app/layout.tsx', () => {
    const appDir = path.join(tmpDir, 'app');
    fs.mkdirSync(appDir, { recursive: true });

    fs.writeFileSync(
      path.join(appDir, 'layout.tsx'),
      `
import { ModalProvider } from '@/providers/ModalProvider';
import { RefProvider } from '@/providers/RefProvider';
import { SourceTrackingProvider } from '@/providers/SourceTrackingProvider';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <ModalProvider>
          <RefProvider>
            <SourceTrackingProvider>
              {children}
            </SourceTrackingProvider>
          </RefProvider>
        </ModalProvider>
      </body>
    </html>
  );
}
`,
    );

    const providers = scanLayoutProviders(tmpDir);
    expect(providers).toHaveLength(3);

    const labels = providers.map((p) => p.label);
    expect(labels).toContain('ModalProvider');
    expect(labels).toContain('RefProvider');
    expect(labels).toContain('SourceTrackingProvider');
  });

  it('skips known library providers (e.g. ThemeProvider)', () => {
    const appDir = path.join(tmpDir, 'app');
    fs.mkdirSync(appDir, { recursive: true });

    fs.writeFileSync(
      path.join(appDir, 'layout.tsx'),
      `
import { ThemeProvider } from 'styled-components';
import { ModalProvider } from '@/providers/ModalProvider';

export default function Layout({ children }) {
  return (
    <ThemeProvider theme={{}}>
      <ModalProvider>
        {children}
      </ModalProvider>
    </ThemeProvider>
  );
}
`,
    );

    const providers = scanLayoutProviders(tmpDir);
    expect(providers).toHaveLength(1);
    expect(providers[0].label).toBe('ModalProvider');
  });

  it('returns empty array when no layout file exists', () => {
    const providers = scanLayoutProviders(tmpDir);
    expect(providers).toHaveLength(0);
  });

  it('handles default imports of providers', () => {
    const appDir = path.join(tmpDir, 'app');
    fs.mkdirSync(appDir, { recursive: true });

    fs.writeFileSync(
      path.join(appDir, 'layout.tsx'),
      `
import AuthProvider from '@/providers/AuthProvider';

export default function Layout({ children }) {
  return <AuthProvider>{children}</AuthProvider>;
}
`,
    );

    const providers = scanLayoutProviders(tmpDir);
    expect(providers).toHaveLength(1);
    expect(providers[0].label).toBe('AuthProvider');
  });

  it('finds providers in src/app/layout.tsx', () => {
    const appDir = path.join(tmpDir, 'src', 'app');
    fs.mkdirSync(appDir, { recursive: true });

    fs.writeFileSync(
      path.join(appDir, 'layout.tsx'),
      `
import { ToastProvider } from '@/providers/ToastProvider';

export default function Layout({ children }) {
  return <ToastProvider>{children}</ToastProvider>;
}
`,
    );

    const providers = scanLayoutProviders(tmpDir);
    expect(providers).toHaveLength(1);
    expect(providers[0].label).toBe('ToastProvider');
  });
});
