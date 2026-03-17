import type { PropMeta } from '../parser/componentParser.js';

const MAX_VARIANT_OPTIONS = 6;

// Priority order for variant prop names (higher index = lower priority)
const VARIANT_PROP_PRIORITY = ['variant', 'type', 'kind', 'size', 'color', 'theme'];

/**
 * Finds the best prop to use for generating variant stories.
 * Looks for string literal unions, prioritising common variant prop names.
 */
export function detectVariantProp(props: PropMeta[]): PropMeta | undefined {
  // Filter to only string literal union props with a manageable number of options
  const candidates = props.filter((p) => {
    const literals = extractStringLiterals(stripNullable(p.typeName));
    return literals.length >= 2 && literals.length <= MAX_VARIANT_OPTIONS;
  });

  if (candidates.length === 0) return undefined;

  // Sort by priority
  const sorted = [...candidates].sort((a, b) => {
    const ai = VARIANT_PROP_PRIORITY.indexOf(a.name);
    const bi = VARIANT_PROP_PRIORITY.indexOf(b.name);
    // Both in priority list: lower index wins
    if (ai !== -1 && bi !== -1) return ai - bi;
    // Only a is in priority list
    if (ai !== -1) return -1;
    // Only b is in priority list
    if (bi !== -1) return 1;
    // Neither: stable sort (keep original order)
    return candidates.indexOf(a) - candidates.indexOf(b);
  });

  return sorted[0];
}

/**
 * Generates an array of story descriptors from a variant prop.
 * Each entry has the story name and the value to use.
 */
export function generateVariantStories(
  variantProp: PropMeta
): Array<{ name: string; value: string }> {
  const literals = extractStringLiterals(stripNullable(variantProp.typeName));
  return literals.slice(0, MAX_VARIANT_OPTIONS).map((value) => ({
    name: capitalise(value),
    value,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripNullable(typeName: string): string {
  return typeName
    .split('|')
    .map((p) => p.trim())
    .filter((p) => p !== 'undefined' && p !== 'null')
    .join(' | ')
    .trim();
}

function extractStringLiterals(typeName: string): string[] {
  const parts = typeName.split('|').map((p) => p.trim());
  const literals: string[] = [];
  for (const part of parts) {
    const match = part.match(/^['"](.+)['"]$/);
    if (match) literals.push(match[1]);
  }
  return literals;
}

function capitalise(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
