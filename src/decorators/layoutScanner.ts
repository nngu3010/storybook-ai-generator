import fs from 'fs';
import path from 'path';
import type { DetectedProvider } from './providerDetector.js';

/**
 * Well-known root layout/app files where providers are typically wrapped.
 * Checked in order of likelihood.
 */
const LAYOUT_CANDIDATES = [
  'app/layout.tsx',
  'app/layout.jsx',
  'src/app/layout.tsx',
  'src/app/layout.jsx',
  'pages/_app.tsx',
  'pages/_app.jsx',
  'src/pages/_app.tsx',
  'src/pages/_app.jsx',
  'src/App.tsx',
  'src/App.jsx',
];

/**
 * Scans root layout/app files for JSX provider wrappers.
 * Returns DetectedProvider entries for any custom providers found
 * (e.g. ModalProvider, RefProvider, SourceTrackingProvider).
 */
export function scanLayoutProviders(projectDir: string): DetectedProvider[] {
  for (const candidate of LAYOUT_CANDIDATES) {
    const fullPath = path.join(projectDir, candidate);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, 'utf-8');
    const providers = extractProviders(content, candidate);
    if (providers.length > 0) return providers;
  }

  return [];
}

/**
 * Extracts provider components from a layout file's JSX.
 *
 * Looks for:
 * 1. Import statements that import something ending with "Provider"
 * 2. Those providers used as JSX wrappers in the return statement
 *
 * Returns provider entries with import statements and wrapper templates.
 */
function extractProviders(content: string, layoutPath: string): DetectedProvider[] {
  // Step 1: Find all imports of *Provider components
  const providerImports = new Map<string, string>();

  // Named imports: import { FooProvider } from '...'
  // Also handles: import { FooProvider, BarProvider } from '...'
  const namedImportRe = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = namedImportRe.exec(content)) !== null) {
    const names = match[1].split(',').map((n) => n.trim());
    const source = match[2];
    for (const name of names) {
      // Handle "Foo as BarProvider" aliasing
      const aliasMatch = name.match(/(\w+)\s+as\s+(\w+)/);
      const finalName = aliasMatch ? aliasMatch[2] : name;
      if (finalName.endsWith('Provider') && !isKnownLibraryProvider(finalName)) {
        providerImports.set(finalName, source);
      }
    }
  }

  // Default imports: import FooProvider from '...'
  const defaultImportRe = /import\s+([A-Z]\w*Provider)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = defaultImportRe.exec(content)) !== null) {
    const name = match[1];
    const source = match[2];
    if (!isKnownLibraryProvider(name)) {
      providerImports.set(name, source);
    }
  }

  if (providerImports.size === 0) return [];

  // Step 2: Check which imported providers are actually used as JSX wrappers
  const detected: DetectedProvider[] = [];

  for (const [name, source] of providerImports) {
    // Check if it appears as a JSX tag: <FooProvider or <FooProvider>
    const jsxPattern = new RegExp(`<${name}[\\s>/]`);
    if (!jsxPattern.test(content)) continue;

    detected.push({
      library: `layout:${layoutPath}`,
      label: name,
      importStatement: `import { ${name} } from '${source}';`,
      wrapper: `<${name}>{children}</${name}>`,
    });
  }

  return detected;
}

/**
 * Providers from well-known npm packages that are already handled
 * by the package.json-based detector. We skip these to avoid duplicates.
 */
const KNOWN_LIBRARY_PROVIDERS = new Set([
  'Provider',        // react-redux
  'ReduxProvider',
  'QueryClientProvider',
  'ThemeProvider',
  'IntlProvider',
  'NextIntlClientProvider',
  'RecoilRoot',
  'JotaiProvider',
]);

function isKnownLibraryProvider(name: string): boolean {
  return KNOWN_LIBRARY_PROVIDERS.has(name);
}
