import type { PropMeta } from '../parser/componentParser.js';
import { extractStringLiterals } from '../utils/stringLiterals.js';

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
 * Marker for component-reference arg values that cannot be JSON-serialized.
 * The story builder emits these as raw identifiers with a corresponding import.
 */
export interface ComponentRef {
  __componentRef: true;
  importName: string;
  importSource: string;
}

export function isComponentRef(value: unknown): value is ComponentRef {
  return typeof value === 'object' && value !== null && (value as any).__componentRef === true;
}

/**
 * Returns true if the type string represents a React component type
 * (e.g. LucideIcon, ComponentType, FC, IconType, ForwardRefExoticComponent).
 */
export function isComponentTypeProp(typeName: string): boolean {
  const clean = stripNullable(typeName);
  return isComponentType(clean);
}

/**
 * Returns true if the type string represents a ReactNode-like type that can accept children.
 * Matches: ReactNode, ReactElement, ReactChild, JSX.Element, React.ReactNode, etc.
 */
export function isReactNodeType(typeName: string): boolean {
  const clean = stripNullable(typeName);
  return /\bReact\.(ReactNode|ReactElement|ReactChild)\b|\bReactNode\b|\bReactElement\b|\bReactChild\b|\bJSX\.Element\b/.test(clean);
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
export function getDefaultArg(prop: PropMeta): unknown {
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
    // Array/object literal defaults — parse to avoid double-stringification
    if (prop.defaultValue === '[]' || prop.defaultValue === '{}') {
      try { return JSON.parse(prop.defaultValue); } catch { /* fall through */ }
    }
    return prop.defaultValue;
  }

  const clean = stripNullable(prop.typeName);

  // ReactNode-like props — return a placeholder string (CSF3 passes it as children)
  if (isReactNodeType(clean)) return 'Content goes here';

  if (clean === 'string') return '';
  if (clean === 'number') return 0;
  if (clean === 'boolean') return false;

  // String literal union — return the first option
  const literals = extractStringLiterals(clean);
  if (literals.length > 0) return literals[0];

  // Array types — return empty array
  if (/\[\]$/.test(clean) || /^Array</.test(clean)) return [];

  // Record / object types — return empty object
  if (/^Record</.test(clean) || /^{/.test(clean)) return {};

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

  // Component type props (LucideIcon, ComponentType, FC, IconType, etc.) → no control
  if (isComponentType(clean)) {
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

function isComponentType(typeName: string): boolean {
  return /\b(LucideIcon|IconType|ComponentType|React\.ComponentType|FC|React\.FC|FunctionComponent|React\.FunctionComponent|ForwardRefExoticComponent|React\.ForwardRefExoticComponent|ElementType|React\.ElementType)\b/.test(typeName);
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
