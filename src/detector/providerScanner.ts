import fs from 'fs';

export interface RequiredDecorator {
  /** Provider label (e.g. "Redux", "Next.js Router") */
  label: string;
  /** Import statements needed in the story file */
  imports: string[];
  /** Decorator code wrapping the story — uses `{children}` as placeholder */
  decorator: string;
}

/** Hook/import patterns → decorator configs */
const HOOK_PATTERNS: Array<{
  /** Regex to test against the file content */
  pattern: RegExp;
  /** Decorator config to add when matched */
  decorator: RequiredDecorator;
}> = [
  // Redux
  {
    pattern: /\b(useSelector|useDispatch|useStore|connect\()\b/,
    decorator: {
      label: 'Redux',
      imports: [
        "import { Provider as ReduxProvider } from 'react-redux';",
        "import { configureStore } from '@reduxjs/toolkit';",
      ],
      decorator: '<ReduxProvider store={configureStore({ reducer: {} })}>{children}</ReduxProvider>',
    },
  },
  // Next.js App Router (import-based detection)
  {
    pattern: /from\s+['"]next\/(navigation|router)['"]/,
    decorator: {
      label: 'Next.js Router',
      imports: [
        "import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';",
      ],
      decorator: '<AppRouterContext.Provider value={{ push: () => Promise.resolve(), replace: () => Promise.resolve(), prefetch: () => Promise.resolve(), back: () => {}, forward: () => {}, refresh: () => {} } as any}>{children}</AppRouterContext.Provider>',
    },
  },
  // Next.js Router (simpler detection — useRouter() without explicit next import)
  {
    pattern: /\buseRouter\(\)/,
    decorator: {
      label: 'Next.js Router',
      imports: [
        "import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';",
      ],
      decorator: '<AppRouterContext.Provider value={{ push: () => Promise.resolve(), replace: () => Promise.resolve(), prefetch: () => Promise.resolve(), back: () => {}, forward: () => {}, refresh: () => {} } as any}>{children}</AppRouterContext.Provider>',
    },
  },
  // React Router
  {
    pattern: /\b(useNavigate|useLocation|useParams|useMatch|useRoutes)\b.*from\s+['"]react-router/s,
    decorator: {
      label: 'React Router',
      imports: ["import { MemoryRouter } from 'react-router-dom';"],
      decorator: '<MemoryRouter>{children}</MemoryRouter>',
    },
  },
  // React Query / TanStack Query
  {
    pattern: /\b(useQuery|useMutation|useQueryClient|useInfiniteQuery)\b/,
    decorator: {
      label: 'React Query',
      imports: ["import { QueryClient, QueryClientProvider } from '@tanstack/react-query';"],
      decorator: '<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>',
    },
  },
];

/**
 * Scans a component file (and optionally its local imports) to detect
 * which provider wrappers (decorators) are needed for its stories.
 *
 * This does a shallow scan of the file content + direct local imports.
 */
export function scanRequiredDecorators(
  filePath: string,
  fileContent?: string,
): RequiredDecorator[] {
  const content = fileContent ?? fs.readFileSync(filePath, 'utf-8');

  // Also scan direct local imports (one level deep)
  const allContent = gatherImportedContent(filePath, content);

  const detected: RequiredDecorator[] = [];
  const seen = new Set<string>();

  for (const { pattern, decorator } of HOOK_PATTERNS) {
    if (seen.has(decorator.label)) continue;
    if (pattern.test(allContent)) {
      seen.add(decorator.label);
      // Only add decorators that have actual wrapper code
      // (Next.js Router is special — detected but handled via storybook addon)
      if (decorator.decorator) {
        detected.push(decorator);
      }
    }
  }

  // Scan for custom context hooks: useXxxContext() or useXxx() from local files
  // that import from a *Provider or *Context file
  const customContextDecorators = detectCustomContextProviders(filePath, content);
  for (const dec of customContextDecorators) {
    if (!seen.has(dec.label)) {
      seen.add(dec.label);
      detected.push(dec);
    }
  }

  return detected;
}

/**
 * Reads content of local imports (relative paths) one level deep.
 * Returns concatenated content for pattern matching.
 */
function gatherImportedContent(filePath: string, content: string): string {
  const parts = [content];
  const dir = filePath.replace(/[/\\][^/\\]+$/, '');

  // Match relative imports: import ... from './foo' or '../bar'
  const importRegex = /from\s+['"](\.\.?\/[^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    // Try common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];
    for (const ext of extensions) {
      const fullPath = `${dir}/${importPath}${importPath.endsWith(ext) ? '' : ext}`;
      try {
        if (fs.existsSync(fullPath)) {
          parts.push(fs.readFileSync(fullPath, 'utf-8'));
          break;
        }
      } catch {
        // ignore read errors
      }
    }
  }

  return parts.join('\n');
}

/**
 * Detects custom context providers by looking for patterns like:
 * - import { useModal } from '../providers/ModalProvider'
 * - import { useAuth } from '@/contexts/AuthContext'
 *
 * These are project-specific providers we can't auto-generate decorators for,
 * but we can flag them in the story file as a TODO comment.
 */
function detectCustomContextProviders(filePath: string, content: string): RequiredDecorator[] {
  const results: RequiredDecorator[] = [];

  // Match imports from files with "Provider" or "Context" in the path
  const contextImportRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]*(?:Provider|Context|provider|context)[^'"]*)['"]/g;
  let match;
  while ((match = contextImportRegex.exec(content)) !== null) {
    const importedNames = match[1].split(',').map(s => s.trim());
    const importPath = match[2];

    // Look for hook-like imports (useXxx)
    const hooks = importedNames.filter(name => /^use[A-Z]/.test(name));
    if (hooks.length === 0) continue;

    // Extract provider name from import path
    const pathParts = importPath.split('/');
    const lastPart = pathParts[pathParts.length - 1].replace(/\.(ts|tsx|js|jsx)$/, '');
    const providerName = lastPart;

    results.push({
      label: providerName,
      imports: [`// TODO: import and configure ${providerName} for Storybook`],
      decorator: `{/* TODO: wrap with <${providerName}> */}{children}`,
    });
  }

  return results;
}
