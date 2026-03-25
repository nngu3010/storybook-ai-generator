import Anthropic from '@anthropic-ai/sdk';
import type { ComponentMeta, PropMeta } from '../parser/componentParser.js';
import { getDefaultArg } from '../mapper/typeMapper.js';
import { detectVariantProp, generateVariantStories } from '../mapper/variantDetector.js';
import { logger } from '../utils/logger.js';
import type { ProjectContext } from '../mcp/contextScanner.js';
import type { ResolvedTypeDefinition } from '../parser/typeResolver.js';
import type { Project } from 'ts-morph';
import { classifyComplexity } from './typeComplexity.js';
import { generateHeuristicArgs } from './heuristicGenerator.js';
import { applyPropRelationships } from './propRelationships.js';

export interface AiStoryArgs {
  /** Args for the Default story */
  Default: Record<string, unknown>;
  /** Args for each variant story, keyed by story name */
  variants: Record<string, Record<string, unknown>>;
}

/**
 * Calls the Claude API to generate realistic, semantically meaningful args
 * for a component's stories based on its name, prop types, and JSDoc.
 */
export async function generateAiArgs(
  meta: ComponentMeta,
  client: Anthropic,
  projectContext?: ProjectContext,
  resolvedTypes?: Map<string, ResolvedTypeDefinition>,
  project?: Project,
): Promise<AiStoryArgs> {
  // Tiered model strategy: skip LLM for simple components
  if (project) {
    const { tier } = classifyComplexity(meta.props, project);
    if (tier === 'simple') {
      logger.info(`${meta.name}: simple props — using heuristics (no API call)`);
      return generateHeuristicArgs(meta, projectContext, resolvedTypes);
    }
  }

  const variantProp = detectVariantProp(meta.props);
  const variantStories = variantProp ? generateVariantStories(variantProp) : [];

  const propDescriptions = meta.props.map((p) => ({
    name: p.name,
    type: p.typeName,
    required: p.required,
    description: p.description ?? '',
    defaultValue: p.defaultValue,
  }));

  const storyNames = ['Default', ...variantStories.map((v) => v.name)];

  const prompt = buildPrompt(meta.name, propDescriptions, storyNames, variantProp ?? null, projectContext, resolvedTypes);

  // Select model based on complexity tier
  let model = 'claude-haiku-4-5-20251001';
  let maxTokens = 1024;
  if (project) {
    const { tier } = classifyComplexity(meta.props, project);
    if (tier === 'complex') {
      model = 'claude-sonnet-4-20250514';
      maxTokens = 2048;
      logger.info(`${meta.name}: complex props — using Sonnet for deeper inference`);
    } else {
      logger.info(`${meta.name}: medium complexity — using Haiku`);
    }
  }

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return parseAiResponse(text, meta, variantStories);
  } catch (err) {
    logger.warn(`AI arg generation failed for ${meta.name}, falling back to defaults: ${(err as Error).message}`);
    return buildFallbackArgs(meta, variantStories);
  }
}

/**
 * Creates an Anthropic client. Reads ANTHROPIC_API_KEY from env.
 */
export function createAiClient(): Anthropic {
  return new Anthropic();
}

function buildPrompt(
  componentName: string,
  props: Array<{ name: string; type: string; required: boolean; description: string; defaultValue?: string }>,
  storyNames: string[],
  variantProp: PropMeta | null,
  projectContext?: ProjectContext,
  resolvedTypes?: Map<string, ResolvedTypeDefinition>,
): string {
  const propsTable = props
    .filter((p) => !isFunctionProp(p.type))
    .map((p) => {
      const parts = [`  - ${p.name}: ${p.type}`];
      if (p.description) parts.push(`(${p.description})`);
      if (p.defaultValue) parts.push(`[default: ${p.defaultValue}]`);
      if (!p.required) parts.push('[optional]');
      return parts.join(' ');
    })
    .join('\n');

  // Build type definitions section from resolved types
  let typeDefsSection = '';
  if (resolvedTypes && resolvedTypes.size > 0) {
    const typeLines: string[] = [];
    let totalChars = 0;
    const MAX_TYPE_CHARS = 2000;

    for (const [, resolved] of resolvedTypes) {
      if (totalChars >= MAX_TYPE_CHARS) break;
      const serialized = serializeTypeForPrompt(resolved, 0);
      if (totalChars + serialized.length > MAX_TYPE_CHARS) break;
      typeLines.push(serialized);
      totalChars += serialized.length;
    }

    if (typeLines.length > 0) {
      typeDefsSection = `
Type Definitions (use these to generate correctly shaped objects with all required fields):
${typeLines.join('\n\n')}
`;
    }
  }

  let contextSection = '';
  if (projectContext?.componentUsages?.length) {
    const snippets = projectContext.componentUsages
      .flatMap((u) => u.snippets)
      .slice(0, 5)
      .join('\n');
    contextSection += `
Here are real usages of this component found in the codebase — use similar values:
${snippets}
`;
  }
  if (projectContext?.mockDataFiles?.length) {
    const dataPreviews = projectContext.mockDataFiles
      .slice(0, 3)
      .map((f) => `// ${f.file}\n${f.preview.slice(0, 500)}`)
      .join('\n\n');
    contextSection += `
Here are data/mock files from the project — use realistic values that match this data:
${dataPreviews}
`;
  }

  return `You are generating realistic example args for a React component's Storybook stories.

Component: ${componentName}
Props:
${propsTable}

Stories to generate args for: ${storyNames.join(', ')}
${variantProp ? `The variant prop is "${variantProp.name}" — each variant story should use a different value for this prop.` : ''}
${typeDefsSection}${contextSection}
Rules:
- Return ONLY a JSON object, no markdown fences, no explanation
- Keys are story names, values are objects with prop names as keys
- Use realistic, meaningful values that demonstrate the component's purpose
- Prefer values from the real usage examples above when available
- Strings should be realistic content (e.g. "Save changes" for a button label, "John Doe" for a user name)
- Numbers should be plausible (e.g. 42 for a count, 4.5 for a rating)
- Booleans should vary across stories to show different states
- For optional props with no default, include them in some stories and omit in others
- Skip function/callback props (onClick, onChange, etc.)
- Keep string values concise (under 50 chars)
- CRITICAL: For props with object/interface types (like StoreInfo, BannerData, Product), return actual JSON objects with realistic fields — NEVER return a plain string
- For array-typed props, return an array of objects with realistic sample data — NEVER return a string

Example response format:
{"Default":{"label":"Save changes","size":"md"},"Primary":{"label":"Submit form","size":"lg"}}`;
}

/**
 * Serialize a resolved type definition into a readable pseudo-TypeScript format for the LLM prompt.
 */
function serializeTypeForPrompt(resolved: ResolvedTypeDefinition, indent: number): string {
  const pad = '  '.repeat(indent);

  if (resolved.kind === 'enum' && resolved.enumMembers) {
    const members = resolved.enumMembers.map(m => `${pad}  ${m.name} = ${JSON.stringify(m.value)}`).join('\n');
    return `${pad}enum ${resolved.name} {\n${members}\n${pad}}`;
  }

  if (resolved.kind === 'union' && resolved.unionMembers) {
    return `${pad}type ${resolved.name} = ${resolved.unionMembers.join(' | ')}`;
  }

  if (resolved.kind === 'array' && resolved.elementType) {
    const elementStr = resolved.elementType.kind === 'interface' && resolved.elementType.properties
      ? serializeTypeForPrompt(resolved.elementType, indent)
      : resolved.elementType.text ?? resolved.elementType.name;
    return `${pad}${resolved.name}: ${elementStr}[]`;
  }

  if (resolved.kind === 'interface' && resolved.properties) {
    const props = Object.entries(resolved.properties).map(([name, prop]) => {
      const opt = prop.required ? '' : '?';
      const desc = prop.description ? ` // ${prop.description}` : '';
      if (prop.resolved && prop.resolved.kind === 'interface' && prop.resolved.properties) {
        const nested = serializeTypeForPrompt(prop.resolved, indent + 1);
        return `${pad}  ${name}${opt}: ${nested}`;
      }
      if (prop.resolved && prop.resolved.kind === 'array' && prop.resolved.elementType) {
        const el = prop.resolved.elementType;
        if (el.kind === 'interface' && el.properties) {
          const nested = serializeTypeForPrompt(el, indent + 1);
          return `${pad}  ${name}${opt}: ${nested}[]`;
        }
        return `${pad}  ${name}${opt}: ${el.text ?? el.name}[]${desc}`;
      }
      return `${pad}  ${name}${opt}: ${prop.type}${desc}`;
    });
    return `${pad}interface ${resolved.name} {\n${props.join('\n')}\n${pad}}`;
  }

  return `${pad}type ${resolved.name} = ${resolved.text ?? 'unknown'}`;
}

function parseAiResponse(
  text: string,
  meta: ComponentMeta,
  variantStories: Array<{ name: string; value: string }>,
): AiStoryArgs {
  // Extract JSON from the response (handle potential markdown fences)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn(`Could not parse AI response for ${meta.name}, falling back to defaults`);
    return buildFallbackArgs(meta, variantStories);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, Record<string, unknown>>;

    // Validate and sanitize: only keep props that exist on the component
    const validPropNames = new Set(meta.props.map((p) => p.name));
    const functionProps = new Set(meta.props.filter((p) => isFunctionProp(p.typeName)).map((p) => p.name));

    // Build a map of prop name → type for validation
    const propTypeMap = new Map<string, string>();
    for (const p of meta.props) {
      propTypeMap.set(p.name, p.typeName);
    }

    const sanitize = (args: Record<string, unknown>): Record<string, unknown> => {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(args)) {
        if (validPropNames.has(key) && !functionProps.has(key)) {
          // Validate: don't accept a string for an object/array-typed prop
          const propType = propTypeMap.get(key) ?? '';
          const strippedType = propType.split('|').map(t => t.trim()).filter(t => t !== 'undefined' && t !== 'null').join(' | ');
          if (typeof value === 'string' && isObjectOrArrayType(strippedType)) {
            // Skip — the AI returned a string for a complex type, let fallback handle it
            continue;
          }
          clean[key] = value;
        }
      }
      return clean;
    };

    const defaultArgs = sanitize(parsed['Default'] ?? parsed[Object.keys(parsed)[0]] ?? {});

    // Ensure all required non-function props have values
    for (const prop of meta.props) {
      if (prop.required && !isFunctionProp(prop.typeName) && defaultArgs[prop.name] === undefined) {
        defaultArgs[prop.name] = getDefaultArg(prop) ?? '';
      }
    }

    const variants: Record<string, Record<string, unknown>> = {};
    for (const vs of variantStories) {
      const aiArgs = sanitize(parsed[vs.name] ?? {});
      // Ensure required props and variant prop are present
      for (const prop of meta.props) {
        if (prop.required && !isFunctionProp(prop.typeName) && aiArgs[prop.name] === undefined) {
          aiArgs[prop.name] = defaultArgs[prop.name] ?? getDefaultArg(prop) ?? '';
        }
      }
      variants[vs.name] = aiArgs;
    }

    return {
      Default: applyPropRelationships(defaultArgs, meta.props),
      variants: Object.fromEntries(
        Object.entries(variants).map(([k, v]) => [k, applyPropRelationships(v, meta.props)])
      ),
    };
  } catch {
    logger.warn(`Failed to parse AI JSON for ${meta.name}, falling back to defaults`);
    return buildFallbackArgs(meta, variantStories);
  }
}

function buildFallbackArgs(
  meta: ComponentMeta,
  variantStories: Array<{ name: string; value: string }>,
): AiStoryArgs {
  const defaultArgs: Record<string, unknown> = {};
  const variantProp = detectVariantProp(meta.props);

  for (const prop of meta.props) {
    const val = getDefaultArg(prop);
    if (val !== undefined) {
      defaultArgs[prop.name] = val;
    }
  }

  const variants: Record<string, Record<string, unknown>> = {};
  for (const vs of variantStories) {
    variants[vs.name] = {
      ...defaultArgs,
      ...(variantProp ? { [variantProp.name]: vs.value } : {}),
    };
  }

  return { Default: defaultArgs, variants };
}

function isFunctionProp(typeName: string): boolean {
  return /^\s*\(.*\)\s*=>\s*\S/.test(typeName) || /^Function$/.test(typeName);
}

/**
 * Returns true if the type represents an object, array, or named interface type
 * (i.e., something that should NOT be a plain string in args).
 */
function isObjectOrArrayType(typeName: string): boolean {
  const clean = typeName.trim();
  // Array types
  if (/\[\]$/.test(clean) || /^Array</.test(clean)) return true;
  // Record / inline object types
  if (/^Record</.test(clean) || /^\{/.test(clean)) return true;
  // Named types starting with capital (likely interfaces/type aliases)
  // Exclude known primitives and React types that accept strings
  if (/^[A-Z]/.test(clean) &&
      !['Function', 'String', 'Number', 'Boolean'].includes(clean) &&
      !/^React\./.test(clean) &&
      !/\bReactNode\b|\bReactElement\b|\bJSX\.Element\b/.test(clean) &&
      !/\b(LucideIcon|IconType|ComponentType|FC|FunctionComponent|ElementType|ForwardRefExoticComponent)\b/.test(clean)) {
    return true;
  }
  return false;
}
