import fs from 'fs';
import path from 'path';
import type { ProjectContext } from '../mcp/contextScanner.js';
import type { PropMeta } from '../parser/componentParser.js';

/**
 * Prop name → array of unique literal values found in real JSX usage.
 */
export interface ExtractedUsageArgs {
  [propName: string]: string[];
}

/**
 * Prop name → object shapes extracted from variable references in JSX usage.
 * These are the full object literals found when following variable references.
 */
export interface ExtractedObjectArgs {
  [propName: string]: Record<string, unknown>;
}

/**
 * Parses JSX usage snippets from `scanProjectContext()` and extracts
 * literal prop values actually used in the codebase.
 *
 * Only extracts values for props present in the component's PropMeta[].
 * Skips function props and complex JSX expressions.
 */
export function extractArgsFromUsages(
  usages: ProjectContext['componentUsages'],
  props: PropMeta[],
): ExtractedUsageArgs {
  if (!usages || usages.length === 0) return {};

  const propNames = new Set(props.map((p) => p.name));
  const result: ExtractedUsageArgs = {};

  for (const { snippets } of usages) {
    for (const snippet of snippets) {
      extractFromSnippet(snippet, propNames, result);
    }
  }

  return result;
}

/**
 * Enhanced extraction: follows variable references in JSX to find object literals.
 * When a snippet says `product={productData}`, reads the source file to find
 * the declaration of `productData` and extracts its object shape.
 *
 * @param dir - Project root directory (for resolving file paths)
 */
export function extractObjectArgsFromUsages(
  usages: ProjectContext['componentUsages'],
  props: PropMeta[],
  dir: string,
): ExtractedObjectArgs {
  if (!usages || usages.length === 0) return {};

  const propNames = new Set(props.map((p) => p.name));
  const result: ExtractedObjectArgs = {};

  for (const { file, snippets } of usages) {
    // Read the full source file to resolve variable references
    const fullPath = path.resolve(dir, file);
    let fileContent: string;
    try {
      fileContent = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    for (const snippet of snippets) {
      extractVariableRefsFromSnippet(snippet, propNames, fileContent, result);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Matches JSX prop assignments in a snippet:
 *   propName="string value"
 *   propName='string value'
 *   propName={123}
 *   propName={true}
 *   propName={false}
 *   propName="string with spaces"
 *
 * Does NOT match:
 *   propName={someVariable}
 *   propName={fn()}
 *   propName={`template`}
 *   propName={{ object }}
 *   propName={[array]}
 */
const PROP_STRING_RE = /(\w+)=["']([^"']+)["']/g;
const PROP_CURLY_RE = /(\w+)=\{([^{}]+)\}/g;

function extractFromSnippet(
  snippet: string,
  propNames: Set<string>,
  result: ExtractedUsageArgs,
): void {
  // Match propName="value" and propName='value'
  let match: RegExpExecArray | null;

  PROP_STRING_RE.lastIndex = 0;
  while ((match = PROP_STRING_RE.exec(snippet)) !== null) {
    const [, name, value] = match;
    if (propNames.has(name) && value.trim().length > 0) {
      addUnique(result, name, value);
    }
  }

  // Match propName={literal} — only simple literals
  PROP_CURLY_RE.lastIndex = 0;
  while ((match = PROP_CURLY_RE.exec(snippet)) !== null) {
    const [, name, expr] = match;
    if (!propNames.has(name)) continue;

    const trimmed = expr.trim();

    // String literal: "value" or 'value'
    const strMatch = trimmed.match(/^["']([^"']+)["']$/);
    if (strMatch) {
      addUnique(result, name, strMatch[1]);
      continue;
    }

    // Number literal
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      addUnique(result, name, trimmed);
      continue;
    }

    // Boolean literal
    if (trimmed === 'true' || trimmed === 'false') {
      addUnique(result, name, trimmed);
      continue;
    }

    // Everything else (variables, function calls, objects, arrays, templates) — skip
  }
}

function addUnique(result: ExtractedUsageArgs, name: string, value: string): void {
  if (!result[name]) {
    result[name] = [value];
  } else if (!result[name].includes(value)) {
    result[name].push(value);
  }
}

// ---------------------------------------------------------------------------
// Variable reference resolution
// ---------------------------------------------------------------------------

/** Matches propName={variableName} — a single identifier (no dots, calls, etc.) */
const PROP_VAR_RE = /(\w+)=\{([A-Za-z_$][\w$]*)\}/g;

/** Matches propName={obj.prop} — a property access */
const PROP_DOT_RE = /(\w+)=\{([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$.]*)\}/g;

/**
 * Extracts variable references from JSX and resolves them to object literals
 * found in the same file's source code.
 */
function extractVariableRefsFromSnippet(
  snippet: string,
  propNames: Set<string>,
  fileContent: string,
  result: ExtractedObjectArgs,
): void {
  // First try: propName={varName} — resolve full variable
  PROP_VAR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PROP_VAR_RE.exec(snippet)) !== null) {
    const [, propName, varName] = match;
    if (!propNames.has(propName) || result[propName]) continue;

    // Skip known non-object patterns
    if (/^(true|false|null|undefined|NaN|Infinity)$/.test(varName)) continue;
    if (/^[A-Z][a-z]/.test(varName) && /^(on|handle)/.test(propName)) continue; // event handler

    const obj = resolveVariableToObject(varName, fileContent);
    if (obj && Object.keys(obj).length > 0) {
      result[propName] = obj;
    }
  }

  // Second try: propName={obj.property} — resolve nested access
  PROP_DOT_RE.lastIndex = 0;
  while ((match = PROP_DOT_RE.exec(snippet)) !== null) {
    const [, propName, dotPath] = match;
    if (!propNames.has(propName) || result[propName]) continue;

    const parts = dotPath.split('.');
    const rootVar = parts[0];
    const rootObj = resolveVariableToObject(rootVar, fileContent);
    if (!rootObj) continue;

    // Navigate the dot path
    let current: unknown = rootObj;
    for (let i = 1; i < parts.length; i++) {
      if (typeof current === 'object' && current !== null) {
        current = (current as Record<string, unknown>)[parts[i]];
      } else {
        current = undefined;
        break;
      }
    }

    if (typeof current === 'object' && current !== null && Object.keys(current).length > 0) {
      result[propName] = current as Record<string, unknown>;
    }
  }
}

/**
 * Searches file content for a variable declaration and extracts its object literal value.
 * Handles:
 *   const varName = { key: "value", ... }
 *   const varName: Type = { key: "value", ... }
 *   let varName = { ... }
 */
function resolveVariableToObject(varName: string, fileContent: string): Record<string, unknown> | null {
  // Match: const/let/var varName = { ... } or const/let/var varName: Type = { ... }
  const declPattern = new RegExp(
    `(?:const|let|var)\\s+${escapeRegex(varName)}\\s*(?::\\s*[^=]+)?\\s*=\\s*\\{`,
  );
  const declMatch = declPattern.exec(fileContent);
  if (!declMatch) return null;

  // Extract the object literal — find matching closing brace
  const startIdx = declMatch.index + declMatch[0].length - 1; // position of opening {
  const objStr = extractBalancedBraces(fileContent, startIdx);
  if (!objStr) return null;

  return parseObjectLiteral(objStr);
}

/**
 * Extracts a balanced brace-delimited substring from content starting at the given position.
 * Returns the complete {...} string or null if braces aren't balanced within limit.
 */
function extractBalancedBraces(content: string, startIdx: number): string | null {
  if (content[startIdx] !== '{') return null;

  let depth = 0;
  const MAX_CHARS = 2000; // Don't parse huge objects
  const end = Math.min(content.length, startIdx + MAX_CHARS);

  for (let i = startIdx; i < end; i++) {
    const ch = content[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return content.slice(startIdx, i + 1);
      }
    }
    // Skip string literals to avoid counting braces inside strings
    if (ch === "'" || ch === '"' || ch === '`') {
      const closeIdx = findStringEnd(content, i, ch);
      if (closeIdx > i) i = closeIdx;
    }
  }

  return null; // Unbalanced or too large
}

function findStringEnd(content: string, startIdx: number, quote: string): number {
  for (let i = startIdx + 1; i < content.length; i++) {
    if (content[i] === '\\') { i++; continue; }
    if (content[i] === quote) return i;
    // Template literals can contain ${}, but for simplicity we just find the closing backtick
  }
  return startIdx;
}

/**
 * Parses a JavaScript object literal string into a plain object.
 * Handles string, number, boolean values and nested objects.
 * Skips function values, computed keys, and spread operators.
 */
function parseObjectLiteral(objStr: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Remove outer braces and clean up
  const inner = objStr.slice(1, -1).trim();
  if (!inner) return result;

  // Match simple key-value pairs using regex
  // key: "value" or key: 'value'
  const STRING_VAL_RE = /(\w+)\s*:\s*["']([^"']*?)["']/g;
  const NUMBER_VAL_RE = /(\w+)\s*:\s*(-?\d+(?:\.\d+)?)\s*[,}\n]/g;
  const BOOLEAN_VAL_RE = /(\w+)\s*:\s*(true|false)\s*[,}\n]/g;
  const NULL_VAL_RE = /(\w+)\s*:\s*(null|undefined)\s*[,}\n]/g;

  let match: RegExpExecArray | null;

  STRING_VAL_RE.lastIndex = 0;
  while ((match = STRING_VAL_RE.exec(inner)) !== null) {
    result[match[1]] = match[2];
  }

  NUMBER_VAL_RE.lastIndex = 0;
  while ((match = NUMBER_VAL_RE.exec(inner)) !== null) {
    result[match[1]] = Number(match[2]);
  }

  BOOLEAN_VAL_RE.lastIndex = 0;
  while ((match = BOOLEAN_VAL_RE.exec(inner)) !== null) {
    result[match[1]] = match[2] === 'true';
  }

  NULL_VAL_RE.lastIndex = 0;
  while ((match = NULL_VAL_RE.exec(inner)) !== null) {
    result[match[1]] = null;
  }

  // Also try to extract nested object values
  const NESTED_OBJ_RE = /(\w+)\s*:\s*\{/g;
  NESTED_OBJ_RE.lastIndex = 0;
  while ((match = NESTED_OBJ_RE.exec(inner)) !== null) {
    const key = match[1];
    if (result[key] !== undefined) continue; // Already extracted as a simple value
    const nestedStart = inner.indexOf('{', match.index + match[0].length - 1);
    // Adjust to absolute position in objStr (add 1 for the removed opening brace)
    const absStart = nestedStart + 1;
    const nestedStr = extractBalancedBraces(objStr, absStart);
    if (nestedStr) {
      const nested = parseObjectLiteral(nestedStr);
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
    }
  }

  // Extract arrays of simple values: key: [val1, val2, ...]
  const ARRAY_RE = /(\w+)\s*:\s*\[([^\]]*)\]/g;
  ARRAY_RE.lastIndex = 0;
  while ((match = ARRAY_RE.exec(inner)) !== null) {
    const key = match[1];
    if (result[key] !== undefined) continue;
    const items = match[2].split(',').map(s => s.trim()).filter(Boolean);
    const parsed = items.map(item => {
      if (/^["']/.test(item)) return item.replace(/^["']|["']$/g, '');
      if (/^-?\d+(\.\d+)?$/.test(item)) return Number(item);
      if (item === 'true') return true;
      if (item === 'false') return false;
      return item;
    });
    if (parsed.length > 0) {
      result[key] = parsed;
    }
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
