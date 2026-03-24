import { describe, it, expect } from 'vitest';
import { generateHeuristicArgs } from '../src/ai/heuristicGenerator.js';
import type { ComponentMeta } from '../src/parser/componentParser.js';

function makeMeta(props: ComponentMeta['props'], name = 'TestComponent'): ComponentMeta {
  return { name, filePath: `/src/components/${name}.tsx`, props };
}

// ---------------------------------------------------------------------------
// Complex prop type handling
// ---------------------------------------------------------------------------
describe('generateHeuristicArgs — complex prop shapes', () => {
  it('generates object for named interface type (StoreInfo)', () => {
    const meta = makeMeta([
      { name: 'store', typeName: 'StoreInfo', required: true },
    ], 'StoreDetails');
    const result = generateHeuristicArgs(meta);
    expect(typeof result.Default.store).toBe('object');
    expect(result.Default.store).not.toBeNull();
    expect(Array.isArray(result.Default.store)).toBe(false);
  });

  it('generates object for named type with product context', () => {
    const meta = makeMeta([
      { name: 'product', typeName: 'ProductData', required: true },
    ], 'ProductCard');
    const result = generateHeuristicArgs(meta);
    const product = result.Default.product as Record<string, unknown>;
    expect(typeof product).toBe('object');
    expect(product).toHaveProperty('name');
    expect(product).toHaveProperty('price');
  });

  it('generates object for user-related named type', () => {
    const meta = makeMeta([
      { name: 'user', typeName: 'UserProfile', required: true },
    ], 'AccountDetails');
    const result = generateHeuristicArgs(meta);
    const user = result.Default.user as Record<string, unknown>;
    expect(typeof user).toBe('object');
    expect(user).toHaveProperty('name');
    expect(user).toHaveProperty('email');
  });

  it('generates object for order-related named type', () => {
    const meta = makeMeta([
      { name: 'order', typeName: 'OrderDetails', required: true },
    ], 'OrderSummary');
    const result = generateHeuristicArgs(meta);
    const order = result.Default.order as Record<string, unknown>;
    expect(typeof order).toBe('object');
    expect(order).toHaveProperty('id');
    expect(order).toHaveProperty('status');
  });

  it('generates object for banner/offer data', () => {
    const meta = makeMeta([
      { name: 'banner', typeName: 'BannerConfig', required: true },
    ], 'Banner');
    const result = generateHeuristicArgs(meta);
    const banner = result.Default.banner as Record<string, unknown>;
    expect(typeof banner).toBe('object');
    expect(banner).toHaveProperty('title');
  });

  it('generates object for inline Record types', () => {
    const meta = makeMeta([
      { name: 'config', typeName: 'Record<string, unknown>', required: true },
    ], 'Settings');
    const result = generateHeuristicArgs(meta);
    expect(typeof result.Default.config).toBe('object');
  });

  it('generates object for inline object types', () => {
    const meta = makeMeta([
      { name: 'style', typeName: '{ color: string; fontSize: number }', required: false },
    ], 'StyledBox');
    const result = generateHeuristicArgs(meta);
    expect(typeof result.Default.style).toBe('object');
  });

  it('does NOT treat string-literal unions as objects', () => {
    const meta = makeMeta([
      { name: 'variant', typeName: '"primary" | "secondary" | "danger"', required: false },
    ], 'Button');
    const result = generateHeuristicArgs(meta);
    expect(typeof result.Default.variant).toBe('string');
  });

  it('still handles simple string props as strings', () => {
    const meta = makeMeta([
      { name: 'label', typeName: 'string', required: true },
    ], 'Button');
    const result = generateHeuristicArgs(meta);
    expect(typeof result.Default.label).toBe('string');
  });

  it('generates object for schema-related props', () => {
    const meta = makeMeta([
      { name: 'schema', typeName: 'JsonLdSchema', required: true },
    ], 'DynamicLocalBusinessSchema');
    const result = generateHeuristicArgs(meta);
    expect(typeof result.Default.schema).toBe('object');
  });

  it('generates a generic fallback object for unknown named types', () => {
    const meta = makeMeta([
      { name: 'data', typeName: 'SomeCustomType', required: true },
    ], 'Widget');
    const result = generateHeuristicArgs(meta);
    expect(typeof result.Default.data).toBe('object');
    expect(result.Default.data).not.toBeNull();
  });
});
