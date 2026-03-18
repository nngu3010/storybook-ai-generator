import Anthropic from '@anthropic-ai/sdk';
import type { ComponentMeta, PropMeta } from '../parser/componentParser.js';
import { getDefaultArg } from '../mapper/typeMapper.js';
import { detectVariantProp, generateVariantStories } from '../mapper/variantDetector.js';
import { logger } from '../utils/logger.js';

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
): Promise<AiStoryArgs> {
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

  const prompt = buildPrompt(meta.name, propDescriptions, storyNames, variantProp ?? null);

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
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

  return `You are generating realistic example args for a React component's Storybook stories.

Component: ${componentName}
Props:
${propsTable}

Stories to generate args for: ${storyNames.join(', ')}
${variantProp ? `The variant prop is "${variantProp.name}" — each variant story should use a different value for this prop.` : ''}

Rules:
- Return ONLY a JSON object, no markdown fences, no explanation
- Keys are story names, values are objects with prop names as keys
- Use realistic, meaningful values that demonstrate the component's purpose
- Strings should be realistic content (e.g. "Save changes" for a button label, "John Doe" for a user name)
- Numbers should be plausible (e.g. 42 for a count, 4.5 for a rating)
- Booleans should vary across stories to show different states
- For optional props with no default, include them in some stories and omit in others
- Skip function/callback props (onClick, onChange, etc.)
- Keep string values concise (under 50 chars)

Example response format:
{"Default":{"label":"Save changes","size":"md"},"Primary":{"label":"Submit form","size":"lg"}}`;
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

    const sanitize = (args: Record<string, unknown>): Record<string, unknown> => {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(args)) {
        if (validPropNames.has(key) && !functionProps.has(key)) {
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

    return { Default: defaultArgs, variants };
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
