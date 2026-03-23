import type { ProjectContext } from '../mcp/contextScanner.js';
import type { PropMeta } from '../parser/componentParser.js';
import type { ExtractedUsageArgs } from './usageExtractor.js';

/**
 * Extracts literal property values from data files (mock data, Redux slices,
 * Zustand stores, constants) and matches them to component prop names.
 *
 * This complements `extractArgsFromUsages` — when JSX passes variables like
 * `title={stats.title}`, the usage extractor finds nothing. But if `stats`
 * comes from a data file with `{ title: "Total Revenue" }`, this extractor
 * picks that up.
 */
export function extractValuesFromDataFiles(
  dataFiles: ProjectContext['mockDataFiles'],
  props: PropMeta[],
): ExtractedUsageArgs {
  if (!dataFiles || dataFiles.length === 0) return {};

  const propNames = new Set(props.map((p) => p.name));
  const result: ExtractedUsageArgs = {};

  for (const { preview } of dataFiles) {
    extractFromContent(preview, propNames, result);
  }

  return result;
}

/**
 * Merges two ExtractedUsageArgs objects. `primary` values take precedence
 * (appear first), `secondary` values are appended if not already present.
 */
export function mergeExtracted(
  primary: ExtractedUsageArgs,
  secondary: ExtractedUsageArgs,
): ExtractedUsageArgs {
  const result: ExtractedUsageArgs = {};

  // Copy all primary values
  for (const [key, values] of Object.entries(primary)) {
    result[key] = [...values];
  }

  // Append secondary values that aren't already present
  for (const [key, values] of Object.entries(secondary)) {
    if (!result[key]) {
      result[key] = [...values];
    } else {
      for (const v of values) {
        if (!result[key].includes(v)) {
          result[key].push(v);
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

// Match: key: "value" or key: 'value' (inside objects)
const STRING_PROP_RE = /(\w+)\s*:\s*["']([^"']+)["']/g;

// Match: key: 123 or key: 12.5 or key: -3 (inside objects)
const NUMBER_PROP_RE = /(\w+)\s*:\s*(-?\d+(?:\.\d+)?)\s*[,}\n]/g;

// Match: key: true or key: false (inside objects)
const BOOLEAN_PROP_RE = /(\w+)\s*:\s*(true|false)\s*[,}\n]/g;

// Match: export const KEY = "value"
const CONST_STRING_RE = /export\s+const\s+(\w+)\s*=\s*["']([^"']+)["']/g;

// Match: export const KEY = 123
const CONST_NUMBER_RE = /export\s+const\s+(\w+)\s*=\s*(-?\d+(?:\.\d+)?)\s*[;\n]/g;

function extractFromContent(
  content: string,
  propNames: Set<string>,
  result: ExtractedUsageArgs,
): void {
  let match: RegExpExecArray | null;

  // Object property: string values
  STRING_PROP_RE.lastIndex = 0;
  while ((match = STRING_PROP_RE.exec(content)) !== null) {
    const [, key, value] = match;
    if (propNames.has(key) && value.trim().length > 0) {
      addUnique(result, key, value);
    }
  }

  // Object property: number values
  NUMBER_PROP_RE.lastIndex = 0;
  while ((match = NUMBER_PROP_RE.exec(content)) !== null) {
    const [, key, value] = match;
    if (propNames.has(key)) {
      addUnique(result, key, value);
    }
  }

  // Object property: boolean values
  BOOLEAN_PROP_RE.lastIndex = 0;
  while ((match = BOOLEAN_PROP_RE.exec(content)) !== null) {
    const [, key, value] = match;
    if (propNames.has(key)) {
      addUnique(result, key, value);
    }
  }

  // Exported constants: strings
  CONST_STRING_RE.lastIndex = 0;
  while ((match = CONST_STRING_RE.exec(content)) !== null) {
    const [, key, value] = match;
    // Match const name to prop name (case-insensitive for SCREAMING_CASE)
    const lower = key.toLowerCase();
    for (const propName of propNames) {
      if (propName.toLowerCase() === lower) {
        addUnique(result, propName, value);
      }
    }
  }

  // Exported constants: numbers
  CONST_NUMBER_RE.lastIndex = 0;
  while ((match = CONST_NUMBER_RE.exec(content)) !== null) {
    const [, key, value] = match;
    const lower = key.toLowerCase();
    for (const propName of propNames) {
      if (propName.toLowerCase() === lower) {
        addUnique(result, propName, value);
      }
    }
  }
}

function addUnique(result: ExtractedUsageArgs, name: string, value: string): void {
  if (!result[name]) {
    result[name] = [value];
  } else if (!result[name].includes(value)) {
    result[name].push(value);
  }
}
