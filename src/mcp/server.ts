import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import { findComponents } from '../detector/componentFinder.js';
import { buildProgram } from '../parser/programBuilder.js';
import { parseComponent, type ComponentMeta } from '../parser/componentParser.js';
import { buildStoryContent } from '../generator/storyBuilder.js';
import { writeStory } from '../generator/storyWriter.js';
import { mapPropToArgType } from '../mapper/typeMapper.js';
import { detectVariantProp, generateVariantStories } from '../mapper/variantDetector.js';
import { generateHeuristicArgs } from '../ai/heuristicGenerator.js';
import { categorizeHint } from '../ai/heuristicGenerator.js';
import { scanProjectContext } from './contextScanner.js';
import { generateAiArgs, createAiClient, type AiStoryArgs } from '../ai/argGenerator.js';
import { resolveTypeDefinition, addTypeFiles, resolvePropsTypes, type ResolvedTypeDefinition } from '../parser/typeResolver.js';
import type { Project } from 'ts-morph';

// Module-level type cache shared across MCP calls within a session
const typeCache = new Map<string, ResolvedTypeDefinition | null>();

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'list_components',
    description:
      'Discover all React/TypeScript components in a directory. Returns component names, file paths, ' +
      'and a summary of their props. START HERE — call this first to find components, then use ' +
      'get_component for detailed metadata on specific ones.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Directory to scan for components (absolute or relative path)' },
      },
      required: ['dir'],
    },
  },
  {
    name: 'get_component',
    description:
      'Get full metadata for a specific component: all props with types, required/optional status, ' +
      'default values, JSDoc descriptions, variant detection, and Storybook argTypes mapping. ' +
      'For any prop with a complex type (interface, object, array of objects), follow up with ' +
      'get_type_definition to see the full type structure — this is essential for generating ' +
      'correctly-shaped mock data.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Directory that was scanned' },
        name: { type: 'string', description: 'Component name (e.g. "Button") or file path' },
      },
      required: ['dir', 'name'],
    },
  },
  {
    name: 'get_story',
    description:
      'Get the generated CSF3 Storybook story content for a component. Returns the story file as ' +
      'a string. Useful for reviewing what was generated or understanding the expected story format.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Directory that was scanned' },
        name: { type: 'string', description: 'Component name (e.g. "Button") or file path' },
      },
      required: ['dir', 'name'],
    },
  },
  {
    name: 'check_stories',
    description:
      'Verify that generated story files are in sync with their components. Reports which stories ' +
      'are valid, outdated (props changed), or missing. Use this to identify which components need ' +
      'story generation or regeneration.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Directory to check' },
      },
      required: ['dir'],
    },
  },
  {
    name: 'suggest_args',
    description:
      'Get quick heuristic-generated arg values for a component based on prop names, types, and ' +
      'component context. No API key needed. Good as a starting point for simple components with ' +
      'primitive props. For components with complex/nested types, you will get better results by ' +
      'calling get_component + get_type_definition + find_usage_examples, reasoning about the full ' +
      'context yourself, and passing custom args to generate_stories.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Directory that was scanned' },
        name: { type: 'string', description: 'Component name (e.g. "Button") or file path' },
      },
      required: ['dir', 'name'],
    },
  },
  {
    name: 'scan_project_context',
    description:
      'Scan a project for contextual information: how a component is used in the codebase (JSX ' +
      'snippets with real prop values), mock/fixture data files, design tokens, and Storybook config. ' +
      'Use the output to craft args that are consistent with how the project already uses the component. ' +
      'Output is capped at ~4000 chars.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory to scan' },
        component: { type: 'string', description: 'Component name to find usages for (e.g. "Button")' },
      },
      required: ['dir', 'component'],
    },
  },
  {
    name: 'generate_stories',
    description:
      'Generate and write Storybook story files for components. Pass custom args to create realistic, ' +
      'type-correct stories. Existing hand-edited stories are never overwritten unless overwrite is true.\n\n' +
      'RECOMMENDED WORKFLOW for best results:\n' +
      '1. get_component — understand props, variants, and argTypes\n' +
      '2. get_type_definition — for each complex prop type, resolve the full interface tree\n' +
      '3. find_usage_examples — see how the component is actually used with real prop values\n' +
      '4. get_mock_fixtures — find existing test data to reuse\n' +
      '5. Craft complete, type-correct args using all the context above\n' +
      '6. Call generate_stories with your custom args\n' +
      '7. validate_story — check the generated story compiles correctly\n' +
      '8. If errors: read the error, fix the args, call generate_stories again (max 3 retries)',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Directory containing the components' },
        components: {
          type: 'array',
          description: 'Optional list of component names to generate stories for. If omitted, generates for all components.',
          items: { type: 'string' },
        },
        args: {
          type: 'object',
          description:
            'Custom args per component. Keys are component names, values are objects with ' +
            '`Default` (args for Default story) and `variants` (keyed by variant story name). ' +
            'Example: {"Button":{"Default":{"label":"Save"},"variants":{"Danger":{"label":"Delete","variant":"danger"}}}}',
          additionalProperties: {
            type: 'object',
            properties: {
              Default: { type: 'object', description: 'Args for the Default story' },
              variants: {
                type: 'object',
                description: 'Args per variant story name',
                additionalProperties: { type: 'object' },
              },
            },
          },
        },
        ai: { type: 'boolean', description: 'Use heuristic AI to generate arg values automatically. For best results, craft your own args using get_component + get_type_definition instead.' },
        overwrite: { type: 'boolean', description: 'Overwrite existing hand-edited stories (default: false)' },
        dryRun: { type: 'boolean', description: 'Preview what would be generated without writing files (default: false)' },
      },
      required: ['dir'],
    },
  },
  {
    name: 'get_type_definition',
    description:
      'Resolve a TypeScript type/interface by name and return its full structure as JSON, recursively ' +
      'resolving nested types up to 6 levels deep. ESSENTIAL for complex props — when get_component ' +
      'shows a prop like "cartData: Cart", call this with type="Cart" to see the full interface tree ' +
      '(Cart → items: CartItem[] → product: Product → metadata: ProductMetadata). Use the resolved ' +
      'structure to generate correctly-shaped nested mock data for story args. Works with interfaces, ' +
      'type aliases, and enums.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory to search for types' },
        type: { type: 'string', description: 'TypeScript type name to resolve (e.g. "Cart", "UserProfile", "Product")' },
        maxDepth: { type: 'number', description: 'Max recursion depth for nested types (default: 6)' },
      },
      required: ['dir', 'type'],
    },
  },
  {
    name: 'find_usage_examples',
    description:
      'Find real usage examples of a component in the codebase. Returns JSX snippets showing how ' +
      'the component is actually rendered with real prop values. Use this to understand what prop ' +
      'combinations and values the project actually uses — prefer these real values over invented ' +
      'placeholders when crafting story args.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory to search' },
        component: { type: 'string', description: 'Component name to find usages for (e.g. "Button")' },
      },
      required: ['dir', 'component'],
    },
  },
  {
    name: 'validate_story',
    description:
      'Validate a generated story file by checking it compiles correctly with TypeScript. Returns ' +
      'success or a list of specific error messages with line numbers. ALWAYS call this after ' +
      'generate_stories. If errors are found: read the error message, call get_type_definition for ' +
      'the failing prop type to understand the expected shape, fix the args, and call generate_stories ' +
      'again. This generate → validate → fix loop is the key to producing stories that work.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory' },
        name: { type: 'string', description: 'Component name whose story to validate (e.g. "CartFooter")' },
      },
      required: ['dir', 'name'],
    },
  },
  {
    name: 'get_mock_fixtures',
    description:
      'Find existing test mocks, fixture data, and seed files in the project that match a component\'s ' +
      'prop types. Returns file paths, content previews, and relevance scores from __mocks__, ' +
      '__fixtures__, test files, and data files. Check this BEFORE inventing data — if the project ' +
      'already has mock objects for the types you need, reuse them for consistency with the test suite.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory to search' },
        component: { type: 'string', description: 'Component name to find related mock data for (e.g. "CartFooter")' },
      },
      required: ['dir', 'component'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleListComponents(dir: string): Promise<string> {
  const resolvedDir = path.resolve(dir);
  const componentFiles = await findComponents(resolvedDir);

  if (componentFiles.length === 0) {
    return `No React components found in ${resolvedDir}`;
  }

  const project = buildProgram(resolvedDir, componentFiles);
  const results: object[] = [];

  for (const filePath of componentFiles) {
    const meta = parseComponent(project, filePath);
    if (meta.skipReason) continue;

    results.push({
      name: meta.name,
      file: path.relative(resolvedDir, filePath),
      propCount: meta.props.length,
      requiredProps: meta.props.filter((p) => p.required).map((p) => p.name),
      optionalProps: meta.props.filter((p) => !p.required).map((p) => p.name),
    });
  }

  return JSON.stringify(results, null, 2);
}

async function handleGetComponent(dir: string, name: string): Promise<string> {
  const resolved = await resolveComponentMeta(dir, name);

  if ('error' in resolved) return resolved.error;
  const { meta } = resolved;

  // Variant detection
  const variantProp = detectVariantProp(meta.props);
  let variantInfo: object | undefined;
  if (variantProp) {
    const stories = generateVariantStories(variantProp);
    variantInfo = {
      name: variantProp.name,
      values: stories.map((s) => s.value),
      suggestedStories: stories.map((s) => s.name),
    };
  }

  // ArgTypes mapping
  const argTypes: Record<string, { control: unknown; options?: string[] }> = {};
  for (const p of meta.props) {
    const at = mapPropToArgType(p);
    const entry: { control: unknown; options?: string[] } = { control: at.control ?? at.action ?? null };
    if (at.options) entry.options = at.options;
    argTypes[p.name] = entry;
  }

  // Semantic hints
  const hints: Record<string, string> = {};
  for (const p of meta.props) {
    const hint = categorizeHint(p, meta.name);
    if (hint) hints[p.name] = hint;
  }

  const result = {
    name: meta.name,
    file: meta.filePath,
    props: meta.props.map((p) => ({
      name: p.name,
      type: p.typeName,
      required: p.required,
      ...(p.defaultValue !== undefined ? { default: p.defaultValue } : {}),
      ...(p.description ? { description: p.description } : {}),
      ...(p.deprecated ? { deprecated: true } : {}),
      ...(p.accessedPaths ? { accessedPaths: p.accessedPaths } : {}),
    })),
    ...(variantInfo ? { variantProp: variantInfo } : {}),
    argTypes,
    hints,
  };

  return JSON.stringify(result, null, 2);
}

async function handleGetStory(dir: string, name: string): Promise<string> {
  const resolved = await resolveComponentMeta(dir, name);

  if ('error' in resolved) return resolved.error;
  const { meta, filePath } = resolved;

  const relativePath = path.basename(filePath);
  return buildStoryContent(meta, relativePath);
}

async function handleCheckStories(dir: string): Promise<string> {
  const resolvedDir = path.resolve(dir);
  const componentFiles = await findComponents(resolvedDir);

  if (componentFiles.length === 0) {
    return `No React components found in ${resolvedDir}`;
  }

  const project = buildProgram(resolvedDir, componentFiles);
  const results: object[] = [];

  for (const filePath of componentFiles) {
    const meta = parseComponent(project, filePath);
    if (meta.skipReason) continue;

    const baseName = path.basename(filePath).replace(/\.(tsx?|jsx?)$/, '');
    const storyPath = path.join(path.dirname(filePath), `${baseName}.stories.ts`);
    const relativeFile = path.relative(resolvedDir, filePath);

    if (!fs.existsSync(storyPath)) {
      results.push({ component: meta.name, file: relativeFile, status: 'missing' });
      continue;
    }

    const existingContent = fs.readFileSync(storyPath, 'utf-8');
    const existingChecksum = existingContent.match(/\/\/ @sbook-ai checksum: ([a-f0-9]+)/)?.[1];
    const freshContent = buildStoryContent(meta, path.basename(filePath));
    const freshChecksum = freshContent.match(/\/\/ @sbook-ai checksum: ([a-f0-9]+)/)?.[1];

    if (existingChecksum && freshChecksum && existingChecksum !== freshChecksum) {
      results.push({ component: meta.name, file: relativeFile, status: 'outdated' });
    } else {
      results.push({ component: meta.name, file: relativeFile, status: 'in-sync' });
    }
  }

  return JSON.stringify(results, null, 2);
}

async function handleSuggestArgs(dir: string, name: string): Promise<string> {
  const resolved = await resolveComponentMeta(dir, name);

  if ('error' in resolved) return resolved.error;
  const { meta, project } = resolved;

  const resolvedDir = path.resolve(dir);
  addTypeFiles(project, resolvedDir);
  const resolvedTypes = resolvePropsTypes(meta.props, project, typeCache);
  const projectContext = await scanProjectContext(resolvedDir, meta.name);
  const suggestedArgs = generateHeuristicArgs(meta, projectContext, resolvedTypes);

  return JSON.stringify({ component: meta.name, suggestedArgs }, null, 2);
}

async function handleScanProjectContext(dir: string, component: string): Promise<string> {
  const resolvedDir = path.resolve(dir);
  const result = await scanProjectContext(resolvedDir, component);
  return JSON.stringify(result, null, 2);
}

async function handleGenerateStories(
  dir: string,
  componentNames?: string[],
  argsMap?: Record<string, AiStoryArgs>,
  overwrite?: boolean,
  dryRun?: boolean,
  ai?: boolean,
): Promise<string> {
  const resolvedDir = path.resolve(dir);
  const componentFiles = await findComponents(resolvedDir);

  if (componentFiles.length === 0) {
    return `No React components found in ${resolvedDir}`;
  }

  // Set up AI client if requested and API key is available
  let aiClient: ReturnType<typeof createAiClient> | undefined;
  if (ai && process.env.ANTHROPIC_API_KEY) {
    aiClient = createAiClient();
  }

  const project = buildProgram(resolvedDir, componentFiles);

  // Enrich project with all type definition files for cross-file resolution
  addTypeFiles(project, resolvedDir);

  const results: object[] = [];

  for (const filePath of componentFiles) {
    const meta = parseComponent(project, filePath);
    if (meta.skipReason) continue;

    // Filter to requested components if specified
    if (componentNames && componentNames.length > 0) {
      const match = componentNames.some(
        (n) => n.toLowerCase() === meta.name.toLowerCase() ||
               path.basename(filePath).toLowerCase().includes(n.toLowerCase()),
      );
      if (!match) continue;
    }

    const relativePath = path.basename(filePath);
    let aiArgs = argsMap?.[meta.name];

    // Always run the full pipeline: resolve types + scan context + generate args
    if (!aiArgs) {
      const resolvedTypes = resolvePropsTypes(meta.props, project, typeCache);
      const projectContext = await scanProjectContext(resolvedDir, meta.name);
      if (aiClient) {
        try {
          aiArgs = await generateAiArgs(meta, aiClient, projectContext, resolvedTypes, project);
        } catch {
          aiArgs = generateHeuristicArgs(meta, projectContext, resolvedTypes);
        }
      } else {
        aiArgs = generateHeuristicArgs(meta, projectContext, resolvedTypes);
      }
    }

    const content = buildStoryContent(meta, relativePath, { aiArgs });

    if (dryRun) {
      results.push({
        component: meta.name,
        file: path.relative(resolvedDir, filePath),
        status: 'dry-run',
        preview: content,
      });
      continue;
    }

    const result = writeStory(filePath, content, { overwrite });
    results.push({
      component: meta.name,
      file: path.relative(resolvedDir, filePath),
      status: result,
      ...(aiArgs ? { aiArgsApplied: true } : {}),
    });
  }

  return JSON.stringify(results, null, 2);
}

// ---------------------------------------------------------------------------
// Phase 1 tool handlers: get_type_definition, find_usage_examples,
//                        validate_story, get_mock_fixtures
// ---------------------------------------------------------------------------

async function handleGetTypeDefinition(
  dir: string,
  typeName: string,
  maxDepth?: number,
): Promise<string> {
  const result = await resolveTypeDefinition(dir, typeName, maxDepth);

  if (!result) {
    return JSON.stringify(
      { error: `Type "${typeName}" not found in ${path.resolve(dir)}` },
      null,
      2,
    );
  }

  return JSON.stringify(result, null, 2);
}

async function handleFindUsageExamples(
  dir: string,
  component: string,
): Promise<string> {
  const resolvedDir = path.resolve(dir);
  const context = await scanProjectContext(resolvedDir, component);

  // Return just the usage examples portion with richer metadata
  const result = {
    component,
    usages: context.componentUsages.map((u) => ({
      file: u.file,
      snippets: u.snippets,
    })),
    totalFiles: context.componentUsages.length,
  };

  if (result.usages.length === 0) {
    return JSON.stringify(
      { component, usages: [], message: `No usage examples found for "${component}" in ${resolvedDir}` },
      null,
      2,
    );
  }

  return JSON.stringify(result, null, 2);
}

async function handleValidateStory(
  dir: string,
  name: string,
): Promise<string> {
  const resolvedDir = path.resolve(dir);

  // Find the story file
  const componentFiles = await findComponents(resolvedDir);
  const project = buildProgram(resolvedDir, componentFiles);

  // Find matching component
  const filePath = componentFiles.find((f) => {
    const baseName = path.basename(f).replace(/\.(tsx?|jsx?)$/, '');
    return baseName.toLowerCase() === name.toLowerCase() || f.includes(name);
  });

  if (!filePath) {
    return JSON.stringify(
      { status: 'error', component: name, error: `Component "${name}" not found` },
      null,
      2,
    );
  }

  const baseName = path.basename(filePath).replace(/\.(tsx?|jsx?)$/, '');
  const storyPath = path.join(path.dirname(filePath), `${baseName}.stories.ts`);
  const storyGenPath = path.join(path.dirname(filePath), `${baseName}.stories.generated.ts`);

  // Check which story file exists
  let actualStoryPath: string | null = null;
  if (fs.existsSync(storyPath)) {
    actualStoryPath = storyPath;
  } else if (fs.existsSync(storyGenPath)) {
    actualStoryPath = storyGenPath;
  }

  if (!actualStoryPath) {
    return JSON.stringify(
      { status: 'error', component: name, error: `No story file found. Expected: ${path.relative(resolvedDir, storyPath)}` },
      null,
      2,
    );
  }

  // Validate by adding the story file to a ts-morph project and checking for diagnostics
  try {
    const storyContent = fs.readFileSync(actualStoryPath, 'utf-8');

    // Add story file to the project for type checking
    let storySf = project.getSourceFile(actualStoryPath);
    if (!storySf) {
      storySf = project.addSourceFileAtPath(actualStoryPath);
    }

    const diagnostics = storySf.getPreEmitDiagnostics();

    // Filter to meaningful errors (skip module resolution issues)
    const errors = diagnostics.filter((d) => {
      const msg = d.getMessageText();
      const msgText = typeof msg === 'string' ? msg : msg.getMessageText();
      // Skip module/config errors common in isolated analysis
      if (msgText.includes('Cannot find module')) return false;
      if (msgText.includes('Cannot find name')) return false;
      if (msgText.includes('.d.ts')) return false;
      if (msgText.includes('is not under')) return false;
      if (msgText.includes('rootDir')) return false;
      if (msgText.includes('--jsx')) return false;
      if (msgText.includes('was resolved to')) return false;
      return true;
    });

    if (errors.length === 0) {
      // Extract story export names
      const storyExports = storyContent
        .match(/export const (\w+): Story/g)
        ?.map((m) => m.replace(/export const (\w+): Story/, '$1')) ?? [];

      return JSON.stringify(
        {
          status: 'pass',
          component: name,
          storyFile: path.relative(resolvedDir, actualStoryPath),
          stories: storyExports,
        },
        null,
        2,
      );
    }

    // Return error details
    const errorDetails = errors.slice(0, 10).map((d) => {
      const msg = d.getMessageText();
      const line = d.getLineNumber();
      return {
        message: typeof msg === 'string' ? msg : msg.getMessageText(),
        ...(line !== undefined ? { line } : {}),
      };
    });

    return JSON.stringify(
      {
        status: 'fail',
        component: name,
        storyFile: path.relative(resolvedDir, actualStoryPath),
        errors: errorDetails,
        errorCount: errors.length,
      },
      null,
      2,
    );
  } catch (err) {
    return JSON.stringify(
      { status: 'error', component: name, error: (err as Error).message },
      null,
      2,
    );
  }
}

async function handleGetMockFixtures(
  dir: string,
  component: string,
): Promise<string> {
  const resolvedDir = path.resolve(dir);
  const context = await scanProjectContext(resolvedDir, component);

  // Return mock/fixture data enriched with component name matching
  const allMocks = context.mockDataFiles;

  // Score and sort: files whose name or content mentions the component rank higher
  const componentLower = component.toLowerCase();
  const scored = allMocks.map((m) => {
    let score = 0;
    if (m.file.toLowerCase().includes(componentLower)) score += 10;
    if (m.preview.toLowerCase().includes(componentLower)) score += 5;
    // Also boost mock/fixture files
    if (/mock|fixture|seed/i.test(m.file)) score += 3;
    return { ...m, relevance: score };
  });

  scored.sort((a, b) => b.relevance - a.relevance);

  const result = {
    component,
    fixtures: scored.map((m) => ({
      file: m.file,
      relevance: m.relevance > 0 ? 'high' : 'low',
      preview: m.preview,
    })),
    totalFiles: scored.length,
  };

  if (result.fixtures.length === 0) {
    return JSON.stringify(
      { component, fixtures: [], message: `No mock/fixture files found in ${resolvedDir}` },
      null,
      2,
    );
  }

  return JSON.stringify(result, null, 2);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ResolvedComponent {
  meta: ComponentMeta;
  project: Project;
  filePath: string;
}

async function resolveComponentMeta(
  dir: string,
  name: string,
): Promise<ResolvedComponent | { error: string }> {
  const resolvedDir = path.resolve(dir);
  const componentFiles = await findComponents(resolvedDir);

  if (componentFiles.length === 0) {
    return { error: `No React components found in ${resolvedDir}` };
  }

  const project = buildProgram(resolvedDir, componentFiles);

  // Match by component name or file path substring
  const filePath = componentFiles.find((f) => {
    const baseName = path.basename(f).replace(/\.(tsx?|jsx?)$/, '');
    return baseName.toLowerCase() === name.toLowerCase() || f.includes(name);
  });

  if (!filePath) {
    const available = componentFiles.map((f) =>
      path.basename(f).replace(/\.(tsx?|jsx?)$/, '')
    );
    return { error: `Component "${name}" not found. Available: ${available.join(', ')}` };
  }

  const meta = parseComponent(project, filePath);

  if (meta.skipReason) {
    return { error: `Component "${name}" was skipped: ${meta.skipReason}` };
  }

  return { meta, project, filePath };
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

export async function startMcpServer(version: string): Promise<void> {
  const server = new Server(
    { name: 'sbook-ai', version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const input = (args ?? {}) as Record<string, unknown>;

    try {
      let text: string;

      switch (name) {
        case 'list_components':
          text = await handleListComponents(input.dir as string);
          break;
        case 'get_component':
          text = await handleGetComponent(input.dir as string, input.name as string);
          break;
        case 'get_story':
          text = await handleGetStory(input.dir as string, input.name as string);
          break;
        case 'check_stories':
          text = await handleCheckStories(input.dir as string);
          break;
        case 'suggest_args':
          text = await handleSuggestArgs(input.dir as string, input.name as string);
          break;
        case 'scan_project_context':
          text = await handleScanProjectContext(input.dir as string, input.component as string);
          break;
        case 'generate_stories':
          text = await handleGenerateStories(
            input.dir as string,
            input.components as string[] | undefined,
            input.args as Record<string, AiStoryArgs> | undefined,
            input.overwrite as boolean | undefined,
            input.dryRun as boolean | undefined,
            input.ai as boolean | undefined,
          );
          break;
        case 'get_type_definition':
          text = await handleGetTypeDefinition(
            input.dir as string,
            input.type as string,
            input.maxDepth as number | undefined,
          );
          break;
        case 'find_usage_examples':
          text = await handleFindUsageExamples(
            input.dir as string,
            input.component as string,
          );
          break;
        case 'validate_story':
          text = await handleValidateStory(
            input.dir as string,
            input.name as string,
          );
          break;
        case 'get_mock_fixtures':
          text = await handleGetMockFixtures(
            input.dir as string,
            input.component as string,
          );
          break;
        default:
          text = `Unknown tool: ${name}`;
      }

      return { content: [{ type: 'text', text }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
