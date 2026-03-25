import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { classifyComplexity } from '../src/ai/typeComplexity.js';
import { buildProgram } from '../src/parser/programBuilder.js';
import { addTypeFiles, resolveTypeDefinitionFromProject, type ResolvedTypeDefinition } from '../src/parser/typeResolver.js';
import { generateHeuristicArgs } from '../src/ai/heuristicGenerator.js';
import type { PropMeta } from '../src/parser/componentParser.js';
import type { ComponentMeta } from '../src/parser/componentParser.js';

const TMP_DIR = path.resolve('tests/.tmp-complexity');

beforeAll(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Types file with varying complexity
  fs.writeFileSync(path.join(TMP_DIR, 'types.ts'), `
    export interface SimpleUser {
      name: string;
      age: number;
    }

    export interface ProductMetadata {
      sku: string;
      weight: number;
      dimensions: Dimensions;
    }

    export interface Dimensions {
      width: number;
      height: number;
      depth: number;
    }

    export interface CartItem {
      product: Product;
      quantity: number;
    }

    export interface Product {
      id: string;
      name: string;
      price: number;
      metadata: ProductMetadata;
    }

    export interface Cart {
      id: string;
      items: CartItem[];
      summary: CartSummary;
      shipping: ShippingDetails;
      coupon?: Coupon;
    }

    export interface CartSummary {
      subtotal: number;
      tax: number;
      total: number;
    }

    export interface ShippingDetails {
      address: Address;
      method: string;
      cost: number;
    }

    export interface Address {
      street: string;
      city: string;
      state: string;
      zip: string;
    }

    export interface Coupon {
      code: string;
      discount: number;
    }
  `);

  // Dummy component so buildProgram has something
  fs.writeFileSync(path.join(TMP_DIR, 'Dummy.tsx'), `
    import React from 'react';
    export default function Dummy() { return <div />; }
  `);
});

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('classifyComplexity', () => {
  function getProject() {
    const project = buildProgram(TMP_DIR, [path.join(TMP_DIR, 'Dummy.tsx')]);
    addTypeFiles(project, TMP_DIR);
    return project;
  }

  it('classifies all-primitive props as simple', () => {
    const props: PropMeta[] = [
      { name: 'label', typeName: 'string', required: true },
      { name: 'count', typeName: 'number', required: false },
      { name: 'disabled', typeName: 'boolean', required: false },
      { name: 'variant', typeName: "'primary' | 'secondary'", required: false },
      { name: 'onClick', typeName: '() => void', required: false },
    ];
    const result = classifyComplexity(props, getProject());
    expect(result.tier).toBe('simple');
    expect(result.complexProps).toHaveLength(0);
  });

  it('classifies a component with 1 shallow complex prop as medium', () => {
    const props: PropMeta[] = [
      { name: 'title', typeName: 'string', required: true },
      { name: 'user', typeName: 'SimpleUser', required: true },
    ];
    const result = classifyComplexity(props, getProject());
    expect(result.tier).toBe('medium');
    expect(result.complexProps).toContain('user');
    expect(result.maxDepth).toBeLessThanOrEqual(2);
  });

  it('classifies a component with deep nested types as complex', () => {
    const props: PropMeta[] = [
      { name: 'cart', typeName: 'Cart', required: true },
      { name: 'product', typeName: 'Product', required: true },
      { name: 'shipping', typeName: 'ShippingDetails', required: true },
      { name: 'coupon', typeName: 'Coupon', required: false },
    ];
    const result = classifyComplexity(props, getProject());
    expect(result.tier).toBe('complex');
    expect(result.complexProps.length).toBeGreaterThan(3);
  });

  it('classifies array-of-objects prop type correctly', () => {
    const props: PropMeta[] = [
      { name: 'items', typeName: 'CartItem[]', required: true },
    ];
    // CartItem[] → strip [] → CartItem → resolve → has Product nested
    const result = classifyComplexity(props, getProject());
    expect(result.complexProps).toContain('items');
    expect(result.maxDepth).toBeGreaterThanOrEqual(2);
  });

  it('does not count ReactNode or LucideIcon as complex', () => {
    const props: PropMeta[] = [
      { name: 'children', typeName: 'ReactNode', required: false },
      { name: 'icon', typeName: 'LucideIcon', required: false },
      { name: 'label', typeName: 'string', required: true },
    ];
    const result = classifyComplexity(props, getProject());
    expect(result.tier).toBe('simple');
  });

  it('handles nullable types (T | undefined)', () => {
    const props: PropMeta[] = [
      { name: 'coupon', typeName: 'Coupon | undefined', required: false },
      { name: 'label', typeName: 'string', required: true },
    ];
    const result = classifyComplexity(props, getProject());
    expect(result.tier).toBe('medium');
    expect(result.complexProps).toContain('coupon');
  });
});

// ---------------------------------------------------------------------------
// Type-aware heuristic generation
// ---------------------------------------------------------------------------

describe('type-aware heuristic generation', () => {
  function getProjectAndTypes() {
    const project = buildProgram(TMP_DIR, [path.join(TMP_DIR, 'Dummy.tsx')]);
    addTypeFiles(project, TMP_DIR);
    const resolvedTypes = new Map<string, ResolvedTypeDefinition>();
    for (const typeName of ['Cart', 'CartSummary', 'CartItem', 'Product', 'Coupon', 'ShippingDetails', 'Address']) {
      const resolved = resolveTypeDefinitionFromProject(project, typeName);
      if (resolved) resolvedTypes.set(typeName, resolved);
    }
    return { project, resolvedTypes };
  }

  it('generates type-aware object for a named interface prop', () => {
    const { resolvedTypes } = getProjectAndTypes();
    const meta: ComponentMeta = {
      name: 'CartFooter',
      filePath: path.join(TMP_DIR, 'Dummy.tsx'),
      props: [
        { name: 'summary', typeName: 'CartSummary', required: true },
      ],
    };

    const result = generateHeuristicArgs(meta, undefined, resolvedTypes);
    const summary = result.Default.summary as Record<string, unknown>;

    // Should have fields from the CartSummary interface
    expect(summary).toBeDefined();
    expect(typeof summary.subtotal).toBe('number');
    expect(typeof summary.tax).toBe('number');
    expect(typeof summary.total).toBe('number');
    // Verify at least 3 numeric fields were generated from the resolved type
    const numericFields = Object.values(summary).filter(v => typeof v === 'number');
    expect(numericFields.length).toBeGreaterThanOrEqual(3);
  });

  it('generates type-aware nested objects', () => {
    const { resolvedTypes } = getProjectAndTypes();
    const meta: ComponentMeta = {
      name: 'ShippingInfo',
      filePath: path.join(TMP_DIR, 'Dummy.tsx'),
      props: [
        { name: 'shipping', typeName: 'ShippingDetails', required: true },
      ],
    };

    const result = generateHeuristicArgs(meta, undefined, resolvedTypes);
    const shipping = result.Default.shipping as Record<string, unknown>;

    expect(shipping).toBeDefined();
    expect(typeof shipping.method).toBe('string');
    expect(typeof shipping.cost).toBe('number');
    // Nested Address object
    const address = shipping.address as Record<string, unknown>;
    expect(address).toBeDefined();
    expect(typeof address.street).toBe('string');
    expect(typeof address.city).toBe('string');
  });

  it('generates array of typed objects for CartItem[]', () => {
    const { resolvedTypes } = getProjectAndTypes();
    const meta: ComponentMeta = {
      name: 'CartList',
      filePath: path.join(TMP_DIR, 'Dummy.tsx'),
      props: [
        { name: 'items', typeName: 'CartItem[]', required: true },
      ],
    };

    const result = generateHeuristicArgs(meta, undefined, resolvedTypes);
    const items = result.Default.items as Array<Record<string, unknown>>;

    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);
    // Each item should have product (nested) and quantity
    expect(typeof items[0].quantity).toBe('number');
    expect(items[0].product).toBeDefined();
    const product = items[0].product as Record<string, unknown>;
    expect(typeof product.id).toBe('string');
    expect(typeof product.name).toBe('string');
    expect(typeof product.price).toBe('number');
  });

  it('falls back to name-based heuristics when no resolved type', () => {
    const meta: ComponentMeta = {
      name: 'StoreCard',
      filePath: path.join(TMP_DIR, 'Dummy.tsx'),
      props: [
        { name: 'store', typeName: 'StoreInfo', required: true },
      ],
    };

    // No resolvedTypes passed — should use existing pattern matching
    const result = generateHeuristicArgs(meta);
    const store = result.Default.store as Record<string, unknown>;

    expect(store).toBeDefined();
    expect(typeof store.name).toBe('string');
  });
});
