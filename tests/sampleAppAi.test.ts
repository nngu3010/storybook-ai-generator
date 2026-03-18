/**
 * End-to-end test: run sbook-ai against /dev/sample-app with AI-style args.
 *
 * This simulates the MCP agent workflow:
 *   1. Discover components
 *   2. Parse metadata
 *   3. Generate stories with crafted realistic args
 *   4. Verify output quality
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { findComponents } from '../src/detector/componentFinder.js';
import { buildProgram } from '../src/parser/programBuilder.js';
import { parseComponent, type ComponentMeta } from '../src/parser/componentParser.js';
import { buildStoryContent } from '../src/generator/storyBuilder.js';
import { writeStory } from '../src/generator/storyWriter.js';
import { mapPropToArgType, getDefaultArg } from '../src/mapper/typeMapper.js';
import type { AiStoryArgs } from '../src/ai/argGenerator.js';

const SAMPLE_APP_SRC = path.resolve('/Users/nngu3010/dev/sample-app/src');
const SAMPLE_APP_EXISTS = fs.existsSync(SAMPLE_APP_SRC);

const describeIf = SAMPLE_APP_EXISTS ? describe : describe.skip;
const STORY_FILES: string[] = [];

// Realistic args that an AI agent would generate
const AI_ARGS: Record<string, AiStoryArgs> = {
  ProductCard: {
    Default: {
      id: 1,
      name: 'Organic Avocados',
      price: 4.99,
      originalPrice: 6.99,
      image: '🥑',
      category: 'Fresh Produce',
      badge: 'sale',
    },
    variants: {
      Sale: {
        id: 2,
        name: 'Greek Yogurt Pack',
        price: 3.49,
        originalPrice: 5.99,
        image: '🥛',
        category: 'Dairy',
        badge: 'sale',
      },
      New: {
        id: 3,
        name: 'Sparkling Water 12-Pack',
        price: 7.99,
        image: '💧',
        category: 'Beverages',
        badge: 'new',
      },
      Popular: {
        id: 4,
        name: 'Trail Mix',
        price: 5.49,
        image: '🥜',
        category: 'Snacks',
        badge: 'popular',
      },
    },
  },
  CategoryCard: {
    Default: {
      name: 'Fresh Produce',
      emoji: '🥬',
      itemCount: 42,
    },
    variants: {},
  },
  CartSidebar: {
    Default: {
      isOpen: true,
      items: [
        { id: 1, name: 'Organic Avocados', price: 4.99, quantity: 2, image: '🥑' },
        { id: 2, name: 'Oat Milk', price: 3.99, quantity: 1, image: '🥛' },
        { id: 3, name: 'Sourdough Bread', price: 5.49, quantity: 1, image: '🍞' },
      ],
    },
    variants: {},
  },
  Header: {
    Default: {
      cartItemCount: 3,
      searchValue: '',
    },
    variants: {},
  },
  HeroBanner: {
    Default: {
      title: 'Fresh Groceries Delivered in 30 Minutes',
      subtitle: 'Order from your favorite local stores',
    },
    variants: {},
  },
  FAQAccordion: {
    Default: {
      items: [
        { question: 'How fast is delivery?', answer: 'Most orders arrive within 30 minutes of placing your order.' },
        { question: 'Is there a minimum order?', answer: 'No minimum order required. However, orders under $10 have a $2.99 small order fee.' },
        { question: 'Can I schedule a delivery?', answer: 'Yes! You can schedule deliveries up to 7 days in advance.' },
      ],
    },
    variants: {},
  },
  SearchBar: {
    Default: {
      placeholder: 'Search for snacks, drinks, essentials...',
      value: '',
    },
    variants: {},
  },
  PromoBanner: {
    Default: {
      title: 'Free Delivery on Your First Order',
      description: 'Use code WELCOME at checkout. Valid for orders over $15.',
      ctaText: 'Shop Now',
      backgroundColor: '#FFD700',
    },
    variants: {},
  },
  ProductGrid: {
    Default: {
      title: 'Featured Products',
      products: [
        { id: 1, name: 'Organic Avocados', price: 4.99, originalPrice: 6.99, image: '🥑', category: 'Fresh Produce', badge: 'sale' as const },
        { id: 2, name: 'Cold Brew Coffee', price: 3.99, image: '☕', category: 'Beverages', badge: 'new' as const },
        { id: 3, name: 'Protein Bar Pack', price: 8.99, image: '💪', category: 'Snacks', badge: 'popular' as const },
      ],
    },
    variants: {},
  },
};

let allComponents: Array<{ meta: ComponentMeta; filePath: string }> = [];

beforeAll(async () => {
  const componentFiles = await findComponents(SAMPLE_APP_SRC);
  const project = buildProgram(SAMPLE_APP_SRC, componentFiles);

  for (const filePath of componentFiles) {
    const meta = parseComponent(project, filePath);
    if (!meta.skipReason) {
      allComponents.push({ meta, filePath });
    }
  }
});

afterAll(() => {
  // Clean up any generated story files
  for (const f of STORY_FILES) {
    try { fs.unlinkSync(f); } catch {}
  }
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

describeIf('sample-app: discovery', () => {
  it('finds all expected components', () => {
    const names = allComponents.map((c) => c.meta.name);
    expect(names).toContain('ProductCard');
    expect(names).toContain('CartSidebar');
    expect(names).toContain('HeroBanner');
    expect(names).toContain('FAQAccordion');
    expect(names).toContain('SearchBar');
    expect(names).toContain('ProductGrid');
    expect(names).toContain('PromoBanner');
    expect(names).toContain('Header');
    expect(names).toContain('CategoryCard');
  });
});

// ---------------------------------------------------------------------------
// Without AI: baseline (empty/default args)
// ---------------------------------------------------------------------------

describeIf('sample-app: baseline (no AI)', () => {
  it('ProductCard has empty string defaults', () => {
    const { meta } = allComponents.find((c) => c.meta.name === 'ProductCard')!;
    const content = buildStoryContent(meta, 'ProductCard.tsx');
    expect(content).toContain('name: ""');
    expect(content).toContain('price: 0');
    expect(content).toContain('image: ""');
  });

  it('CartSidebar items defaults to empty array', () => {
    const { meta } = allComponents.find((c) => c.meta.name === 'CartSidebar')!;
    const content = buildStoryContent(meta, 'CartSidebar.tsx');
    expect(content).toContain('items: []');
  });

  it('HeroBanner has empty title and subtitle', () => {
    const { meta } = allComponents.find((c) => c.meta.name === 'HeroBanner')!;
    const content = buildStoryContent(meta, 'HeroBanner.tsx');
    expect(content).toContain('title: ""');
    expect(content).toContain('subtitle: ""');
  });

  it('FAQAccordion items defaults to empty array', () => {
    const { meta } = allComponents.find((c) => c.meta.name === 'FAQAccordion')!;
    const content = buildStoryContent(meta, 'FAQAccordion.tsx');
    expect(content).toContain('items: []');
  });
});

// ---------------------------------------------------------------------------
// With AI args: realistic values
// ---------------------------------------------------------------------------

describeIf('sample-app: with AI args', () => {
  it('ProductCard has realistic product data', () => {
    const { meta } = allComponents.find((c) => c.meta.name === 'ProductCard')!;
    const content = buildStoryContent(meta, 'ProductCard.tsx', { aiArgs: AI_ARGS.ProductCard });

    expect(content).toContain('"Organic Avocados"');
    expect(content).toContain('4.99');
    expect(content).toContain('6.99');
    expect(content).toContain('"🥑"');
    expect(content).toContain('"Fresh Produce"');
  });

  it('ProductCard variant stories have different products', () => {
    const { meta } = allComponents.find((c) => c.meta.name === 'ProductCard')!;
    const content = buildStoryContent(meta, 'ProductCard.tsx', { aiArgs: AI_ARGS.ProductCard });

    expect(content).toContain('"Greek Yogurt Pack"');  // Sale variant
    expect(content).toContain('"Sparkling Water 12-Pack"');  // New variant
    expect(content).toContain('"Trail Mix"');  // Popular variant
  });

  it('CartSidebar has realistic cart items', () => {
    const { meta } = allComponents.find((c) => c.meta.name === 'CartSidebar')!;
    const content = buildStoryContent(meta, 'CartSidebar.tsx', { aiArgs: AI_ARGS.CartSidebar });

    expect(content).toContain('"Organic Avocados"');
    expect(content).toContain('"Oat Milk"');
    expect(content).toContain('"Sourdough Bread"');
    expect(content).toContain('isOpen: true');
  });

  it('HeroBanner has meaningful headline', () => {
    const { meta } = allComponents.find((c) => c.meta.name === 'HeroBanner')!;
    const content = buildStoryContent(meta, 'HeroBanner.tsx', { aiArgs: AI_ARGS.HeroBanner });

    expect(content).toContain('"Fresh Groceries Delivered in 30 Minutes"');
    expect(content).toContain('"Order from your favorite local stores"');
  });

  it('FAQAccordion has realistic questions and answers', () => {
    const { meta } = allComponents.find((c) => c.meta.name === 'FAQAccordion')!;
    const content = buildStoryContent(meta, 'FAQAccordion.tsx', { aiArgs: AI_ARGS.FAQAccordion });

    expect(content).toContain('How fast is delivery?');
    expect(content).toContain('minimum order');
    expect(content).toContain('schedule a delivery');
  });

  it('PromoBanner has compelling CTA copy', () => {
    const { meta } = allComponents.find((c) => c.meta.name === 'PromoBanner')!;
    const content = buildStoryContent(meta, 'PromoBanner.tsx', { aiArgs: AI_ARGS.PromoBanner });

    expect(content).toContain('"Free Delivery on Your First Order"');
    expect(content).toContain('"Shop Now"');
    expect(content).toContain('WELCOME');
  });

  it('ProductGrid has realistic product list', () => {
    const { meta } = allComponents.find((c) => c.meta.name === 'ProductGrid')!;
    const content = buildStoryContent(meta, 'ProductGrid.tsx', { aiArgs: AI_ARGS.ProductGrid });

    expect(content).toContain('"Featured Products"');
    expect(content).toContain('"Organic Avocados"');
    expect(content).toContain('"Cold Brew Coffee"');
  });

  it('SearchBar has realistic placeholder', () => {
    const { meta } = allComponents.find((c) => c.meta.name === 'SearchBar')!;
    const content = buildStoryContent(meta, 'SearchBar.tsx', { aiArgs: AI_ARGS.SearchBar });

    expect(content).toContain('"Search for snacks, drinks, essentials..."');
  });
});

// ---------------------------------------------------------------------------
// Quality comparison: AI vs baseline
// ---------------------------------------------------------------------------

describeIf('sample-app: AI quality comparison', () => {
  it('AI args produce longer, more meaningful story content', () => {
    const { meta } = allComponents.find((c) => c.meta.name === 'ProductCard')!;
    const baseline = buildStoryContent(meta, 'ProductCard.tsx');
    const aiVersion = buildStoryContent(meta, 'ProductCard.tsx', { aiArgs: AI_ARGS.ProductCard });

    // AI version should be significantly longer (more realistic data)
    expect(aiVersion.length).toBeGreaterThan(baseline.length);

    // Count non-empty string args
    const baselineEmptyStrings = (baseline.match(/: ""/g) || []).length;
    const aiEmptyStrings = (aiVersion.match(/: ""/g) || []).length;
    expect(aiEmptyStrings).toBeLessThan(baselineEmptyStrings);
  });

  it('AI args fill array props with actual data', () => {
    const { meta } = allComponents.find((c) => c.meta.name === 'CartSidebar')!;
    const baseline = buildStoryContent(meta, 'CartSidebar.tsx');
    const aiVersion = buildStoryContent(meta, 'CartSidebar.tsx', { aiArgs: AI_ARGS.CartSidebar });

    // Baseline has empty array, AI version has real items
    expect(baseline).toContain('items: []');
    expect(aiVersion).not.toContain('items: []');
    expect(aiVersion).toContain('Organic Avocados');
  });

  it('both versions maintain valid story structure', () => {
    for (const { meta } of allComponents) {
      const aiArgs = AI_ARGS[meta.name];
      const content = buildStoryContent(meta, `${meta.name}.tsx`, { aiArgs });

      expect(content).toMatch(/\/\/ @sbook-ai checksum:/);
      expect(content).toContain("from '@storybook/react'");
      expect(content).toContain('export default meta');
      expect(content).toContain('export const Default: Story');

      // Balanced braces
      let depth = 0;
      for (const ch of content) {
        if (ch === '{' || ch === '[' || ch === '(') depth++;
        if (ch === '}' || ch === ']' || ch === ')') depth--;
      }
      expect(depth).toBe(0);
    }
  });
});
