import path from 'path';

/**
 * Determines whether a file is likely a React component.
 * Returns a confidence score between 0 and 1.
 */
export function isComponent(filePath: string, fileContent: string): boolean {
  return componentConfidence(filePath, fileContent) >= 0.5;
}

/**
 * Returns a 0–1 confidence score for whether the file is a React component.
 */
export function componentConfidence(filePath: string, fileContent: string): number {
  const fileName = path.basename(filePath);
  const nameWithoutExt = fileName.replace(/\.(tsx?|jsx?)$/, '');

  // Hard exclusions — always 0
  if (/\.(test|spec)\.(tsx?|jsx?)$/.test(fileName)) return 0;
  if (/\.stories\.(tsx?|jsx?)$/.test(fileName)) return 0;

  // Barrel files that only re-export (no JSX at all)
  const isBarrel = isOnlyReExports(fileContent);
  if (isBarrel) return 0;

  // Async server components cannot render in Storybook
  if (isAsyncServerComponent(fileContent)) return 0;

  // Must be a .tsx or .jsx file to contain JSX
  if (!/\.(tsx|jsx)$/.test(filePath)) return 0;

  let score = 0;

  // +0.4 — has a default export
  const hasDefaultExport = /export\s+default\s+/.test(fileContent);
  if (hasDefaultExport) score += 0.4;

  // +0.3 — exported name starts with capital letter
  const capitalExportMatch =
    /export\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)/.test(fileContent) ||
    /export\s+default\s+([A-Z][A-Za-z0-9_]*)/.test(fileContent) ||
    /(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*[=:]/.test(fileContent);

  if (capitalExportMatch) score += 0.3;

  // Also check file name starts with capital (common convention)
  if (/^[A-Z]/.test(nameWithoutExt)) score += 0.1;

  // +0.2 — returns JSX (looks for JSX syntax in function body)
  const hasJsx =
    /return\s*\(?\s*<[A-Za-z]/.test(fileContent) ||
    /=>\s*\(?\s*<[A-Za-z]/.test(fileContent) ||
    /=>\s*<[A-Za-z]/.test(fileContent);
  if (hasJsx) score += 0.2;

  // −0.3 — HOC pattern: function returning a function/component
  const isHoc =
    /return\s+function\s+[A-Z]/.test(fileContent) ||
    /return\s+\(\s*props\s*\)/.test(fileContent) ||
    /:\s*React\.FC\s*</.test(fileContent) && /return\s+\(props\)/.test(fileContent);
  if (isHoc) score -= 0.3;

  return Math.max(0, Math.min(1, score));
}

/**
 * Checks if a file is a barrel (index) file containing only re-exports
 * and no component definitions.
 */
function isOnlyReExports(content: string): boolean {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('*'));

  if (lines.length === 0) return true;

  const nonExportLines = lines.filter(
    (l) =>
      !l.startsWith('export {') &&
      !l.startsWith('export *') &&
      !l.startsWith('export type') &&
      !l.startsWith('export default') &&
      !l.startsWith("import ") &&
      !l.startsWith('// ') &&
      l !== ''
  );

  // If all meaningful lines are re-exports or imports, it's a barrel
  const allExports = lines.every(
    (l) =>
      l.startsWith('export {') ||
      l.startsWith('export *') ||
      l.startsWith('export type {') ||
      l.startsWith("import ") ||
      l === ''
  );

  return allExports && nonExportLines.length === 0;
}

/**
 * Detects async server components — these export an async function as default
 * and do NOT have a 'use client' directive, meaning they're server-only.
 */
export function isAsyncServerComponent(content: string): boolean {
  // If file has 'use client' directive, it's a client component (even if async)
  if (/^\s*['"]use client['"];?\s*$/m.test(content)) return false;

  // Check for async default export patterns:
  // - export default async function Foo()
  // - const Foo = async () => ... ; export default Foo
  // - export default async () =>
  if (/export\s+default\s+async\s+function\b/.test(content)) return true;
  if (/export\s+default\s+async\s*\(/.test(content)) return true;

  // Check for: const Foo = async (...) => ... with export default Foo
  const asyncConstMatch = content.match(/(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=\s*async\s/);
  if (asyncConstMatch) {
    const name = asyncConstMatch[1];
    const exportPattern = new RegExp(`export\\s+default\\s+${name}\\b`);
    if (exportPattern.test(content)) return true;
  }

  return false;
}
