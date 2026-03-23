import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildStoryContent } from '../src/generator/storyBuilder.js';
import { generateHeuristicArgs } from '../src/ai/heuristicGenerator.js';
import { isComponentRef } from '../src/mapper/typeMapper.js';
import type { ComponentMeta } from '../src/parser/componentParser.js';
import type { AiStoryArgs } from '../src/ai/argGenerator.js';
import type { ProjectContext } from '../src/mcp/contextScanner.js';

// ---------------------------------------------------------------------------
// storyBuilder integration: verify AI args are used when provided
// ---------------------------------------------------------------------------

const buttonMeta: ComponentMeta = {
  name: 'Button',
  filePath: '/src/components/Button.tsx',
  props: [
    { name: 'label', typeName: 'string', required: true, description: 'Button text' },
    { name: 'variant', typeName: '"primary" | "secondary" | "danger"', required: false, defaultValue: "'primary'", description: 'Visual style' },
    { name: 'disabled', typeName: 'boolean', required: false, description: 'Disabled state' },
    { name: 'onClick', typeName: '() => void', required: false, description: 'Click handler' },
  ],
};

describe('storyBuilder with AI args', () => {
  it('uses AI args for the Default story', () => {
    const aiArgs: AiStoryArgs = {
      Default: { label: 'Save changes', variant: 'primary', disabled: false },
      variants: {},
    };

    const content = buildStoryContent(buttonMeta, 'Button.tsx', { aiArgs });

    expect(content).toContain('"Save changes"');
    expect(content).not.toMatch(/"label": ""/);
  });

  it('uses AI args for variant stories', () => {
    const aiArgs: AiStoryArgs = {
      Default: { label: 'Save changes', variant: 'primary', disabled: false },
      variants: {
        Primary: { label: 'Submit form', variant: 'primary', disabled: false },
        Secondary: { label: 'Cancel', variant: 'secondary', disabled: false },
        Danger: { label: 'Delete account', variant: 'danger', disabled: false },
      },
    };

    const content = buildStoryContent(buttonMeta, 'Button.tsx', { aiArgs });

    expect(content).toContain('"Submit form"');
    expect(content).toContain('"Cancel"');
    expect(content).toContain('"Delete account"');
  });

  it('falls back to default args when no AI args provided', () => {
    const content = buildStoryContent(buttonMeta, 'Button.tsx');

    // Without AI, label defaults to empty string
    expect(content).toContain('label: ""');
  });

  it('falls back to default variant args when AI variant is missing', () => {
    const aiArgs: AiStoryArgs = {
      Default: { label: 'Click me', variant: 'primary', disabled: false },
      variants: {
        // Only Primary has AI args, Secondary and Danger will use fallback
        Primary: { label: 'Go', variant: 'primary', disabled: false },
      },
    };

    const content = buildStoryContent(buttonMeta, 'Button.tsx', { aiArgs });

    // Primary uses AI args
    expect(content).toContain('"Go"');
    // Secondary/Danger should still exist (from variant detection) with fallback args
    expect(content).toContain('export const Secondary: Story');
    expect(content).toContain('export const Danger: Story');
  });

  it('preserves checksum, imports, and structure with AI args', () => {
    const aiArgs: AiStoryArgs = {
      Default: { label: 'Save changes', variant: 'primary' },
      variants: {},
    };

    const content = buildStoryContent(buttonMeta, 'Button.tsx', { aiArgs });

    expect(content).toMatch(/\/\/ @sbook-ai checksum:/);
    expect(content).toContain("import type { Meta, StoryObj } from '@storybook/react'");
    expect(content).toContain("import Button from './Button'");
    expect(content).toContain('export default meta');
    expect(content).toContain('export const Default: Story');
  });
});

// ---------------------------------------------------------------------------
// AI arg generator: test prompt building and response parsing
// ---------------------------------------------------------------------------

describe('generateAiArgs', () => {
  it('handles API errors gracefully by falling back to defaults', async () => {
    // Mock the Anthropic client to simulate failure
    const { generateAiArgs } = await import('../src/ai/argGenerator.js');

    const mockClient = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
      },
    } as any;

    const result = await generateAiArgs(buttonMeta, mockClient);

    // Should fall back to defaults
    expect(result.Default).toBeDefined();
    expect(result.Default.label).toBe('');
    expect(result.Default.variant).toBe('primary');
  });

  it('handles malformed JSON response by falling back to defaults', async () => {
    const { generateAiArgs } = await import('../src/ai/argGenerator.js');

    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'This is not JSON at all' }],
        }),
      },
    } as any;

    const result = await generateAiArgs(buttonMeta, mockClient);

    expect(result.Default).toBeDefined();
    expect(result.Default.label).toBe('');
  });

  it('parses valid JSON response into AiStoryArgs', async () => {
    const { generateAiArgs } = await import('../src/ai/argGenerator.js');

    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'text',
            text: JSON.stringify({
              Default: { label: 'Save changes', variant: 'primary', disabled: false },
              Primary: { label: 'Submit', variant: 'primary', disabled: false },
              Secondary: { label: 'Cancel', variant: 'secondary', disabled: false },
              Danger: { label: 'Delete', variant: 'danger', disabled: true },
            }),
          }],
        }),
      },
    } as any;

    const result = await generateAiArgs(buttonMeta, mockClient);

    expect(result.Default.label).toBe('Save changes');
    expect(result.variants.Primary?.label).toBe('Submit');
    expect(result.variants.Secondary?.label).toBe('Cancel');
    expect(result.variants.Danger?.label).toBe('Delete');
  });

  it('strips function props from AI response', async () => {
    const { generateAiArgs } = await import('../src/ai/argGenerator.js');

    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'text',
            text: JSON.stringify({
              Default: { label: 'Click me', onClick: 'should-be-stripped', variant: 'primary' },
            }),
          }],
        }),
      },
    } as any;

    const result = await generateAiArgs(buttonMeta, mockClient);

    // onClick is a function prop and should be stripped
    expect(result.Default.onClick).toBeUndefined();
    expect(result.Default.label).toBe('Click me');
  });

  it('strips unknown props from AI response', async () => {
    const { generateAiArgs } = await import('../src/ai/argGenerator.js');

    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'text',
            text: JSON.stringify({
              Default: { label: 'Hi', nonExistentProp: 'bad', variant: 'primary' },
            }),
          }],
        }),
      },
    } as any;

    const result = await generateAiArgs(buttonMeta, mockClient);

    expect(result.Default.nonExistentProp).toBeUndefined();
    expect(result.Default.label).toBe('Hi');
  });

  it('fills in missing required props with defaults', async () => {
    const { generateAiArgs } = await import('../src/ai/argGenerator.js');

    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'text',
            // AI only returns variant, not the required 'label'
            text: JSON.stringify({
              Default: { variant: 'primary' },
            }),
          }],
        }),
      },
    } as any;

    const result = await generateAiArgs(buttonMeta, mockClient);

    // label is required and should be filled in with default
    expect(result.Default.label).toBeDefined();
  });

  it('handles JSON wrapped in markdown code fences', async () => {
    const { generateAiArgs } = await import('../src/ai/argGenerator.js');

    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'text',
            text: '```json\n{"Default":{"label":"Hello","variant":"primary"}}\n```',
          }],
        }),
      },
    } as any;

    const result = await generateAiArgs(buttonMeta, mockClient);

    expect(result.Default.label).toBe('Hello');
  });
});

// ---------------------------------------------------------------------------
// Component with no variant prop
// ---------------------------------------------------------------------------

describe('AI args for component without variants', () => {
  const cardMeta: ComponentMeta = {
    name: 'Card',
    filePath: '/src/components/Card.tsx',
    props: [
      { name: 'title', typeName: 'string', required: true, description: 'Card title' },
      { name: 'description', typeName: 'string', required: false, description: 'Card description' },
      { name: 'count', typeName: 'number', required: false, description: 'Item count' },
    ],
  };

  it('generates AI args for Default story only', async () => {
    const { generateAiArgs } = await import('../src/ai/argGenerator.js');

    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'text',
            text: JSON.stringify({
              Default: { title: 'Project Alpha', description: 'A new initiative', count: 12 },
            }),
          }],
        }),
      },
    } as any;

    const result = await generateAiArgs(cardMeta, mockClient);

    expect(result.Default.title).toBe('Project Alpha');
    expect(result.Default.count).toBe(12);
    expect(Object.keys(result.variants)).toHaveLength(0);
  });

  it('renders AI args into story content', () => {
    const aiArgs: AiStoryArgs = {
      Default: { title: 'Project Alpha', description: 'A new initiative', count: 12 },
      variants: {},
    };

    const content = buildStoryContent(cardMeta, 'Card.tsx', { aiArgs });

    expect(content).toContain('"Project Alpha"');
    expect(content).toContain('"A new initiative"');
    expect(content).toContain('12');
  });
});

// ---------------------------------------------------------------------------
// storyBuilder with component-type props (ComponentRef)
// ---------------------------------------------------------------------------

const statsCardMeta: ComponentMeta = {
  name: 'StatsCard',
  filePath: '/src/components/StatsCard.tsx',
  props: [
    { name: 'title', typeName: 'string', required: true },
    { name: 'icon', typeName: 'LucideIcon', required: true },
    { name: 'value', typeName: 'number', required: true },
  ],
};

describe('storyBuilder with component-type props', () => {
  it('emits import for ComponentRef args', () => {
    const aiArgs: AiStoryArgs = {
      Default: {
        title: 'Revenue',
        icon: { __componentRef: true, importName: 'Circle', importSource: 'lucide-react' },
        value: 42,
      },
      variants: {},
    };
    const content = buildStoryContent(statsCardMeta, 'StatsCard.tsx', { aiArgs });

    expect(content).toContain("import { Circle } from 'lucide-react'");
    expect(content).toContain('icon: Circle,');
    expect(content).not.toContain('icon: undefined');
  });

  it('emits component ref as raw identifier not JSON string', () => {
    const aiArgs: AiStoryArgs = {
      Default: {
        title: 'Users',
        icon: { __componentRef: true, importName: 'User', importSource: 'lucide-react' },
        value: 100,
      },
      variants: {},
    };
    const content = buildStoryContent(statsCardMeta, 'StatsCard.tsx', { aiArgs });

    // Should NOT be JSON-stringified
    expect(content).not.toContain('"__componentRef"');
    expect(content).toContain('icon: User,');
  });

  it('deduplicates imports when same ref used in multiple stories', () => {
    const aiArgs: AiStoryArgs = {
      Default: {
        title: 'Revenue',
        icon: { __componentRef: true, importName: 'Circle', importSource: 'lucide-react' },
        value: 42,
      },
      variants: {
        Large: {
          title: 'Big Revenue',
          icon: { __componentRef: true, importName: 'Circle', importSource: 'lucide-react' },
          value: 999,
        },
      },
    };
    const content = buildStoryContent(statsCardMeta, 'StatsCard.tsx', { aiArgs });

    // Should only appear once
    const matches = content.match(/import \{ Circle \} from 'lucide-react'/g);
    expect(matches).toHaveLength(1);
  });

  it('maps LucideIcon argType to control: false', () => {
    const aiArgs: AiStoryArgs = {
      Default: {
        title: 'Test',
        icon: { __componentRef: true, importName: 'Circle', importSource: 'lucide-react' },
        value: 0,
      },
      variants: {},
    };
    const content = buildStoryContent(statsCardMeta, 'StatsCard.tsx', { aiArgs });

    expect(content).toContain('icon: { control: false }');
  });
});

// ---------------------------------------------------------------------------
// Heuristic generator with component-type props
// ---------------------------------------------------------------------------

describe('heuristic generator with component-type props', () => {
  it('generates ComponentRef for LucideIcon prop', () => {
    const result = generateHeuristicArgs(statsCardMeta);

    expect(isComponentRef(result.Default.icon)).toBe(true);
    const ref = result.Default.icon as any;
    expect(ref.importName).toBe('Circle');
    expect(ref.importSource).toBe('lucide-react');
  });

  it('chooses contextual icon based on prop name', () => {
    const meta: ComponentMeta = {
      name: 'SearchBar',
      filePath: '/src/components/SearchBar.tsx',
      props: [
        { name: 'searchIcon', typeName: 'LucideIcon', required: true },
      ],
    };
    const result = generateHeuristicArgs(meta);

    const ref = result.Default.searchIcon as any;
    expect(ref.importName).toBe('Search');
    expect(ref.importSource).toBe('lucide-react');
  });

  it('still generates normal args for non-component props', () => {
    const result = generateHeuristicArgs(statsCardMeta);

    expect(typeof result.Default.title).toBe('string');
    expect(typeof result.Default.value).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Context-enriched heuristic generation
// ---------------------------------------------------------------------------

describe('context-enriched heuristic generation', () => {
  const cardMeta: ComponentMeta = {
    name: 'StatsCard',
    filePath: '/src/components/StatsCard.tsx',
    props: [
      { name: 'title', typeName: 'string', required: true },
      { name: 'value', typeName: 'number', required: true },
      { name: 'trend', typeName: 'string', required: false },
    ],
  };

  function makeContext(snippets: string[]): ProjectContext {
    return {
      componentUsages: [{ file: 'Dashboard.tsx', snippets }],
      mockDataFiles: [],
      designTokenFiles: [],
      storybookConfig: {},
    };
  }

  it('uses real string values from project usage', () => {
    const ctx = makeContext(['<StatsCard title="Total Revenue" value={50000} />']);
    const result = generateHeuristicArgs(cardMeta, ctx);
    expect(result.Default.title).toBe('Total Revenue');
  });

  it('coerces extracted number values', () => {
    const ctx = makeContext(['<StatsCard title="Users" value={1234} />']);
    const result = generateHeuristicArgs(cardMeta, ctx);
    expect(result.Default.value).toBe(1234);
  });

  it('cycles through extracted values for variants', () => {
    const metaWithVariant: ComponentMeta = {
      name: 'StatsCard',
      filePath: '/src/components/StatsCard.tsx',
      props: [
        { name: 'title', typeName: 'string', required: true },
        { name: 'value', typeName: 'number', required: true },
        { name: 'size', typeName: "'sm' | 'md' | 'lg'", required: false },
      ],
    };
    const ctx = makeContext([
      '<StatsCard title="Revenue" value={100} />',
      '<StatsCard title="Active Users" value={42} />',
    ]);
    const result = generateHeuristicArgs(metaWithVariant, ctx);

    // Default uses first extracted value, variants cycle
    expect(result.Default.title).toBe('Revenue');
    // Variant stories should use the cycling mechanism
    const variantTitles = Object.values(result.variants).map((v) => v.title);
    expect(variantTitles.some((t) => t === 'Active Users')).toBe(true);
  });

  it('falls back to heuristics when no context provided', () => {
    const result = generateHeuristicArgs(cardMeta);
    // Should still work — just uses pattern-based defaults
    expect(typeof result.Default.title).toBe('string');
    expect(typeof result.Default.value).toBe('number');
  });

  it('falls back to heuristics for props not found in usage', () => {
    const ctx = makeContext(['<StatsCard title="Revenue" value={100} />']);
    const result = generateHeuristicArgs(cardMeta, ctx);
    // trend is not in the usage snippet, should fall back to heuristic
    expect(result.Default.title).toBe('Revenue');
    // trend should still get a value from heuristics (or be undefined if optional)
    // The key point: it doesn't crash
  });

  it('handles empty usages gracefully', () => {
    const ctx: ProjectContext = {
      componentUsages: [],
      mockDataFiles: [],
      designTokenFiles: [],
      storybookConfig: {},
    };
    const result = generateHeuristicArgs(cardMeta, ctx);
    expect(typeof result.Default.title).toBe('string');
  });
});
