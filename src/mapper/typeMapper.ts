import type { PropMeta } from '../parser/componentParser.js';

export interface ArgTypeMeta {
  name: string;
  control?: string | false | { type: string };
  options?: string[];
  action?: string;
  description?: string;
  defaultValue?: string;
  table?: { disable?: boolean };
}

/**
 * Maps a parsed PropMeta to a Storybook ArgType definition.
 */
export function mapPropToArgType(prop: PropMeta): ArgTypeMeta {
  const resolved = resolveControl(prop);
  const base: ArgTypeMeta = {
    name: prop.name,
    ...resolved,
    description: prop.description,
    defaultValue: prop.defaultValue,
  };

  if (prop.deprecated) {
    base.table = { disable: true };
  }

  return base;
}

/**
 * Returns a sensible default arg value based on the prop type.
 */
export function getDefaultArg(prop: PropMeta): string | number | boolean | undefined {
  if (prop.defaultValue !== undefined) {
    // ts-morph returns default values with quotes for strings, e.g. "'primary'" → strip them
    const stripped = stripStringQuotes(prop.defaultValue);
    if (stripped !== null) return stripped;
    // Numeric default
    const n = Number(prop.defaultValue);
    if (!isNaN(n)) return n;
    // Boolean default
    if (prop.defaultValue === 'true') return true;
    if (prop.defaultValue === 'false') return false;
    return prop.defaultValue;
  }

  const clean = stripNullable(prop.typeName);

  if (clean === 'string') return '';
  if (clean === 'number') return 0;
  if (clean === 'boolean') return false;

  // String literal union — return the first option
  const literals = extractStringLiterals(clean);
  if (literals.length > 0) return literals[0];

  return undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strips `| undefined` and `| null` variants from a type string so that
 * the core type can be classified correctly.
 */
/** Strips surrounding quotes from a string like "'primary'" → "primary". Returns null if not a quoted string. */
function stripStringQuotes(value: string): string | null {
  const m = value.match(/^['"](.*)['"]$/);
  return m ? m[1] : null;
}

function stripNullable(typeName: string): string {
  return typeName
    .split('|')
    .map((p) => p.trim())
    .filter((p) => p !== 'undefined' && p !== 'null')
    .join(' | ')
    .trim();
}

type ResolvedControl = Pick<ArgTypeMeta, 'control' | 'options' | 'action'>;

function resolveControl(prop: PropMeta): ResolvedControl {
  const raw = prop.typeName;
  const clean = stripNullable(raw);

  // Function type → action (no control panel)
  if (isFunctionType(clean)) {
    return { action: prop.name };
  }

  // ReactNode / ReactElement / ReactChild → no control
  if (/\bReact\.(ReactNode|ReactElement|ReactChild)\b|\bReactNode\b|\bReactElement\b|\bReactChild\b/.test(clean)) {
    return { control: false };
  }

  // CSSProperties → object
  if (/\bCSSProperties\b|\bReact\.CSSProperties\b/.test(clean)) {
    return { control: 'object' };
  }

  // Array types: X[] or Array<X>
  if (/\[\]$/.test(clean) || /^Array</.test(clean)) {
    return { control: 'object' };
  }

  // Primitive types
  if (clean === 'string') return { control: 'text' };
  if (clean === 'number') return { control: 'number' };
  if (clean === 'boolean') return { control: 'boolean' };

  // String literal union: 'a' | 'b' | 'c'
  const literals = extractStringLiterals(clean);
  if (literals.length > 0) {
    return { control: 'select', options: literals };
  }

  // Number literal union: 1 | 2 | 3
  const numLiterals = extractNumberLiterals(clean);
  if (numLiterals.length > 0) {
    return { control: 'select', options: numLiterals as unknown as string[] };
  }

  // Generic object / complex type — fallback
  return { control: 'object' };
}

function isFunctionType(typeName: string): boolean {
  // Matches: () => void, (x: string) => void, (...args: any[]) => any, etc.
  return /^\s*\(.*\)\s*=>\s*\S/.test(typeName) || /^Function$/.test(typeName);
}

function extractStringLiterals(typeName: string): string[] {
  const parts = typeName.split('|').map((p) => p.trim());
  const literals: string[] = [];
  for (const part of parts) {
    // Match quoted string literals: 'primary' or "primary"
    const match = part.match(/^['"](.*)['"]$/);
    if (match) {
      literals.push(match[1]);
    }
  }
  return literals;
}

function extractNumberLiterals(typeName: string): number[] {
  const parts = typeName.split('|').map((p) => p.trim());
  const literals: number[] = [];
  for (const part of parts) {
    const n = Number(part);
    if (!isNaN(n) && part !== '') {
      literals.push(n);
    }
  }
  if (literals.length === parts.length && parts.length > 1) {
    return literals;
  }
  return [];
}
