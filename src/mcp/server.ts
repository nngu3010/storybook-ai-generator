import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import { findComponents } from '../detector/componentFinder.js';
import { buildProgram } from '../parser/programBuilder.js';
import { parseComponent, type ComponentMeta } from '../parser/componentParser.js';
import { buildStoryContent } from '../generator/storyBuilder.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'list_components',
    description: 'Discover all React/TypeScript components in a directory. Returns component names, file paths, and a summary of their props.',
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
    description: 'Get full metadata for a specific component: all props with types, required/optional status, default values, JSDoc descriptions, and available variant values.',
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
    description: 'Get the generated CSF3 Storybook story content for a component. Returns the story file as a string — useful for understanding how a component should be used.',
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
    description: 'Verify that generated story files are in sync with their components. Reports which stories are valid, outdated, or missing.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Directory to check' },
      },
      required: ['dir'],
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
  const meta = await resolveComponentMeta(dir, name);

  if ('error' in meta) return meta.error;

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
    })),
  };

  return JSON.stringify(result, null, 2);
}

async function handleGetStory(dir: string, name: string): Promise<string> {
  const meta = await resolveComponentMeta(dir, name);

  if ('error' in meta) return meta.error;

  const relativePath = path.basename(meta.filePath);
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveComponentMeta(
  dir: string,
  name: string,
): Promise<ComponentMeta | { error: string }> {
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

  return meta;
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
    const input = (args ?? {}) as Record<string, string>;

    try {
      let text: string;

      switch (name) {
        case 'list_components':
          text = await handleListComponents(input.dir);
          break;
        case 'get_component':
          text = await handleGetComponent(input.dir, input.name);
          break;
        case 'get_story':
          text = await handleGetStory(input.dir, input.name);
          break;
        case 'check_stories':
          text = await handleCheckStories(input.dir);
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
