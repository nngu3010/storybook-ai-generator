import type { Project } from 'ts-morph';
import type { PropMeta } from '../parser/componentParser.js';
import { resolveTypeDefinitionFromProject, type ResolvedTypeDefinition } from '../parser/typeResolver.js';

export type ComplexityTier = 'simple' | 'medium' | 'complex';

export interface ComplexityResult {
  tier: ComplexityTier;
  complexProps: string[];
  maxDepth: number;
}

/**
 * Classify a component's props into a complexity tier for tiered model selection.
 * - Simple: all primitives, string unions, booleans, functions — no LLM needed
 * - Medium: 1-3 complex props with depth <= 2 — Haiku
 * - Complex: >3 complex props or depth > 2 — Sonnet
 */
export function classifyComplexity(
  props: PropMeta[],
  project: Project,
): ComplexityResult {
  const complexProps: string[] = [];
  let maxDepth = 0;

  for (const prop of props) {
    const typeName = extractBaseTypeName(prop.typeName);
    if (!isComplexTypeName(typeName)) continue;

    const resolved = resolveTypeDefinitionFromProject(project, typeName, 4);
    if (!resolved || resolved.kind === 'primitive' || resolved.kind === 'function' || resolved.kind === 'unknown') {
      continue;
    }

    // Unions of string/number literals are not complex
    if (resolved.kind === 'union' && resolved.unionMembers) continue;
    // Enums are not complex
    if (resolved.kind === 'enum') continue;

    complexProps.push(prop.name);
    const depth = measureDepth(resolved);
    if (depth > maxDepth) maxDepth = depth;
  }

  let tier: ComplexityTier;
  if (complexProps.length === 0) {
    tier = 'simple';
  } else if (complexProps.length <= 3 && maxDepth <= 2) {
    tier = 'medium';
  } else {
    tier = 'complex';
  }

  return { tier, complexProps, maxDepth };
}

/**
 * Extract the base type name from a type string, stripping nullability,
 * array brackets, and generic wrappers.
 */
function extractBaseTypeName(typeName: string): string {
  let clean = typeName.trim();
  // Strip nullable: T | undefined | null
  clean = clean.split('|').map(t => t.trim()).filter(t => t !== 'undefined' && t !== 'null').join(' | ');
  // Strip array suffix
  if (clean.endsWith('[]')) clean = clean.slice(0, -2);
  // Strip Array<T>
  const arrayMatch = clean.match(/^Array<(.+)>$/);
  if (arrayMatch) clean = arrayMatch[1];
  return clean.trim();
}

/**
 * Check if a type name represents something complex (named interface/type alias).
 */
function isComplexTypeName(typeName: string): boolean {
  const primitives = ['string', 'number', 'boolean', 'any', 'unknown', 'never', 'void', 'null', 'undefined'];
  if (primitives.includes(typeName)) return false;
  if (/^['"]/.test(typeName)) return false;
  if (/^\(/.test(typeName)) return false;
  if (typeName.includes(' | ') || typeName.includes(' & ')) return false;
  if (/^(React\.|JSX\.)/.test(typeName)) return false;
  if (/^Record</.test(typeName) || /^\{/.test(typeName)) return false;
  if (/\b(ReactNode|ReactElement|LucideIcon|IconType|ComponentType|FC|FunctionComponent|ElementType|ForwardRefExoticComponent)\b/.test(typeName)) return false;
  return /^[A-Z]/.test(typeName);
}

/**
 * Measure the maximum nesting depth of a resolved type definition.
 */
function measureDepth(resolved: ResolvedTypeDefinition): number {
  if (!resolved.properties && !resolved.elementType) return 1;

  let maxChildDepth = 0;

  if (resolved.properties) {
    for (const prop of Object.values(resolved.properties)) {
      if (prop.resolved) {
        const childDepth = measureDepth(prop.resolved);
        if (childDepth > maxChildDepth) maxChildDepth = childDepth;
      }
    }
  }

  if (resolved.elementType) {
    const elementDepth = measureDepth(resolved.elementType);
    if (elementDepth > maxChildDepth) maxChildDepth = elementDepth;
  }

  return 1 + maxChildDepth;
}
