import type { ProjectContext } from '../mcp/contextScanner.js';
import type { PropMeta } from '../parser/componentParser.js';

/**
 * Prop name → array of unique literal values found in real JSX usage.
 */
export interface ExtractedUsageArgs {
  [propName: string]: string[];
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
