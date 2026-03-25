/**
 * Extracts string literal values from a TypeScript union type string.
 * e.g. `"a" | "b" | "c"` → `['a', 'b', 'c']`
 *
 * Returns deduplicated results to handle cases where ts-morph
 * or type resolution produces repeated union members.
 */
export function extractStringLiterals(typeName: string): string[] {
  const parts = typeName.split('|').map((p) => p.trim());
  const literals: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const match = part.match(/^['"](.+)['"]$/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      literals.push(match[1]);
    }
  }
  return literals;
}
