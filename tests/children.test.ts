import { describe, it, expect } from 'vitest';
import type { PropMeta, ComponentMeta } from '../src/parser/componentParser.js';
import { isReactNodeType, getDefaultArg } from '../src/mapper/typeMapper.js';
import { generateHeuristicArgs } from '../src/ai/heuristicGenerator.js';
import { buildStoryContent } from '../src/generator/storyBuilder.js';

// ---------------------------------------------------------------------------
// isReactNodeType
// ---------------------------------------------------------------------------

describe('isReactNodeType', () => {
  it('matches ReactNode', () => {
    expect(isReactNodeType('ReactNode')).toBe(true);
  });

  it('matches React.ReactNode', () => {
    expect(isReactNodeType('React.ReactNode')).toBe(true);
  });

  it('matches ReactElement', () => {
    expect(isReactNodeType('ReactElement')).toBe(true);
  });

  it('matches JSX.Element', () => {
    expect(isReactNodeType('JSX.Element')).toBe(true);
  });

  it('matches nullable ReactNode', () => {
    expect(isReactNodeType('ReactNode | undefined')).toBe(true);
    expect(isReactNodeType('ReactNode | null')).toBe(true);
  });

  it('does not match string', () => {
    expect(isReactNodeType('string')).toBe(false);
  });

  it('does not match number', () => {
    expect(isReactNodeType('number')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getDefaultArg for ReactNode
// ---------------------------------------------------------------------------

describe('getDefaultArg for ReactNode props', () => {
  it('returns placeholder string for children: ReactNode', () => {
    const prop: PropMeta = { name: 'children', typeName: 'ReactNode', required: true };
    expect(getDefaultArg(prop)).toBe('Content goes here');
  });

  it('returns placeholder for React.ReactNode', () => {
    const prop: PropMeta = { name: 'header', typeName: 'React.ReactNode', required: false };
    expect(getDefaultArg(prop)).toBe('Content goes here');
  });

  it('returns placeholder for nullable ReactNode', () => {
    const prop: PropMeta = { name: 'footer', typeName: 'ReactNode | undefined', required: false };
    expect(getDefaultArg(prop)).toBe('Content goes here');
  });
});

// ---------------------------------------------------------------------------
// Heuristic children inference
// ---------------------------------------------------------------------------

describe('heuristic children inference', () => {
  function makeMeta(componentName: string, props: PropMeta[]): ComponentMeta {
    return { name: componentName, filePath: `/fake/${componentName}.tsx`, props };
  }

  it('generates meaningful children for a Button component', () => {
    const meta = makeMeta('Button', [
      { name: 'children', typeName: 'ReactNode', required: true },
      { name: 'variant', typeName: "'primary' | 'secondary'", required: false },
    ]);
    const result = generateHeuristicArgs(meta);
    expect(typeof result.Default.children).toBe('string');
    expect((result.Default.children as string).length).toBeGreaterThan(0);
    // Button children should be CTA-like
    expect(['Save changes', 'Submit', 'Continue', 'Get started']).toContain(result.Default.children);
  });

  it('generates card-appropriate children', () => {
    const meta = makeMeta('ProductCard', [
      { name: 'children', typeName: 'ReactNode', required: true },
    ]);
    const result = generateHeuristicArgs(meta);
    expect(typeof result.Default.children).toBe('string');
    expect((result.Default.children as string).length).toBeGreaterThan(10); // Should be descriptive
  });

  it('generates modal-appropriate children', () => {
    const meta = makeMeta('ConfirmDialog', [
      { name: 'children', typeName: 'ReactNode', required: true },
    ]);
    const result = generateHeuristicArgs(meta);
    expect(typeof result.Default.children).toBe('string');
    expect((result.Default.children as string).length).toBeGreaterThan(10);
  });

  it('generates alert-appropriate children', () => {
    const meta = makeMeta('AlertToast', [
      { name: 'children', typeName: 'ReactNode', required: true },
    ]);
    const result = generateHeuristicArgs(meta);
    expect(typeof result.Default.children).toBe('string');
    expect((result.Default.children as string).length).toBeGreaterThan(5);
  });

  it('generates badge-appropriate children', () => {
    const meta = makeMeta('StatusBadge', [
      { name: 'children', typeName: 'ReactNode', required: true },
    ]);
    const result = generateHeuristicArgs(meta);
    expect(typeof result.Default.children).toBe('string');
    expect(['New', 'Popular', 'Sale', 'Featured']).toContain(result.Default.children);
  });

  it('handles named ReactNode slots (header, footer)', () => {
    const meta = makeMeta('Card', [
      { name: 'header', typeName: 'ReactNode', required: false },
      { name: 'children', typeName: 'ReactNode', required: true },
      { name: 'footer', typeName: 'ReactNode', required: false },
    ]);
    const result = generateHeuristicArgs(meta);
    expect(typeof result.Default.header).toBe('string');
    expect(typeof result.Default.children).toBe('string');
    expect(typeof result.Default.footer).toBe('string');
    // Header, children, and footer should be different content
    expect(result.Default.header).not.toBe(result.Default.children);
    expect(result.Default.footer).not.toBe(result.Default.children);
  });

  it('varies children across variant stories', () => {
    const meta = makeMeta('Alert', [
      { name: 'children', typeName: 'ReactNode', required: true },
      { name: 'variant', typeName: "'info' | 'warning' | 'error'", required: false },
    ]);
    const result = generateHeuristicArgs(meta);
    const defaultChildren = result.Default.children;
    // At least one variant should have different children
    const variantChildren = Object.values(result.variants).map((v) => v.children);
    expect(variantChildren.some((c) => c !== defaultChildren)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: buildStoryContent includes children
// ---------------------------------------------------------------------------

describe('buildStoryContent with children', () => {
  it('includes children arg in generated story', () => {
    const meta: ComponentMeta = {
      name: 'Button',
      filePath: '/fake/Button.tsx',
      props: [
        { name: 'children', typeName: 'ReactNode', required: true },
      ],
    };
    const content = buildStoryContent(meta, './Button');
    expect(content).toContain('children:');
    expect(content).toContain('"Content goes here"');
  });

  it('includes children in heuristic-generated story', () => {
    const meta: ComponentMeta = {
      name: 'Card',
      filePath: '/fake/Card.tsx',
      props: [
        { name: 'children', typeName: 'ReactNode', required: true },
        { name: 'title', typeName: 'string', required: true },
      ],
    };
    const aiArgs = generateHeuristicArgs(meta);
    const content = buildStoryContent(meta, './Card', { aiArgs });
    expect(content).toContain('children:');
    // Should not be empty/undefined
    expect(content).not.toContain('children: undefined');
  });
});
