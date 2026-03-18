import type { ComponentMeta, PropMeta } from '../parser/componentParser.js';
import { getDefaultArg } from '../mapper/typeMapper.js';
import { detectVariantProp, generateVariantStories } from '../mapper/variantDetector.js';
import type { AiStoryArgs } from './argGenerator.js';

/**
 * Generates realistic arg values using keyword heuristics — no API key needed.
 * Analyses component name, prop names, JSDoc descriptions, and types to pick
 * semantically appropriate values.
 */
export function generateHeuristicArgs(meta: ComponentMeta): AiStoryArgs {
  const variantProp = detectVariantProp(meta.props);
  const variantStories = variantProp ? generateVariantStories(variantProp) : [];

  const context = inferContext(meta.name);
  const defaultArgs: Record<string, unknown> = {};

  for (const prop of meta.props) {
    if (isFunctionProp(prop.typeName)) continue;
    defaultArgs[prop.name] = inferValue(prop, context, 0);
  }

  const variants: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < variantStories.length; i++) {
    const vs = variantStories[i];
    const variantArgs: Record<string, unknown> = {};
    for (const prop of meta.props) {
      if (isFunctionProp(prop.typeName)) continue;
      if (prop.name === variantProp!.name) {
        variantArgs[prop.name] = vs.value;
      } else {
        variantArgs[prop.name] = inferValue(prop, context, i + 1);
      }
    }
    variants[vs.name] = variantArgs;
  }

  return { Default: defaultArgs, variants };
}

// ---------------------------------------------------------------------------
// Context inference from component name
// ---------------------------------------------------------------------------

type ComponentContext =
  | 'product' | 'cart' | 'user' | 'search' | 'hero' | 'banner'
  | 'card' | 'form' | 'input' | 'nav' | 'faq' | 'footer'
  | 'button' | 'badge' | 'alert' | 'modal' | 'table'
  | 'generic';

function inferContext(componentName: string): ComponentContext {
  const name = componentName.toLowerCase();
  if (name.includes('product') || name.includes('item') || name.includes('listing')) return 'product';
  if (name.includes('cart') || name.includes('checkout') || name.includes('basket')) return 'cart';
  if (name.includes('user') || name.includes('profile') || name.includes('avatar') || name.includes('account')) return 'user';
  if (name.includes('search')) return 'search';
  if (name.includes('hero')) return 'hero';
  if (name.includes('banner') || name.includes('promo') || name.includes('cta')) return 'banner';
  if (name.includes('card') || name.includes('tile')) return 'card';
  if (name.includes('form') || name.includes('input') || name.includes('field') || name.includes('textarea')) return 'input';
  if (name.includes('nav') || name.includes('header') || name.includes('sidebar') || name.includes('menu')) return 'nav';
  if (name.includes('faq') || name.includes('accordion')) return 'faq';
  if (name.includes('footer')) return 'footer';
  if (name.includes('button') || name.includes('btn')) return 'button';
  if (name.includes('badge') || name.includes('tag') || name.includes('chip') || name.includes('status')) return 'badge';
  if (name.includes('alert') || name.includes('toast') || name.includes('notification')) return 'alert';
  if (name.includes('modal') || name.includes('dialog') || name.includes('drawer')) return 'modal';
  if (name.includes('table') || name.includes('list') || name.includes('grid')) return 'table';
  return 'generic';
}

// ---------------------------------------------------------------------------
// Value inference from prop name + type + context
// ---------------------------------------------------------------------------

function inferValue(prop: PropMeta, context: ComponentContext, variantIndex: number): unknown {
  // If prop has a real default value, use it — but skip empty arrays/objects
  // since the heuristic can generate better sample data
  if (prop.defaultValue !== undefined && prop.defaultValue !== '[]' && prop.defaultValue !== '{}') {
    const def = getDefaultArg(prop);
    if (def !== undefined) return def;
  }

  const clean = stripNullable(prop.typeName);
  const name = prop.name.toLowerCase();
  const desc = (prop.description ?? '').toLowerCase();

  // String literal union — pick first for default, vary for variants
  if (isStringLiteralUnion(clean)) {
    const options = extractStringLiterals(clean);
    if (options.length > 0) return options[variantIndex % options.length];
  }

  // Array types
  if (/\[\]$/.test(clean) || /^Array</.test(clean)) {
    return inferArrayValue(prop, context);
  }

  // Record / object types
  if (/^Record</.test(clean) || /^\{/.test(clean)) return {};

  // Boolean
  if (clean === 'boolean') {
    return inferBooleanValue(name, desc, variantIndex);
  }

  // Number
  if (clean === 'number') {
    return inferNumberValue(name, desc, context, variantIndex);
  }

  // String
  if (clean === 'string') {
    return inferStringValue(name, desc, context, variantIndex);
  }

  return getDefaultArg(prop);
}

// ---------------------------------------------------------------------------
// String inference
// ---------------------------------------------------------------------------

const STRING_PATTERNS: Array<{ match: RegExp; values: string[] }> = [
  // Names (user-related only — generic `name` handled by context)
  { match: /^(user|author|creator|owner)[-_]?name$/i, values: ['Sarah Johnson', 'James Wilson', 'Emily Chen', 'Michael Park'] },
  { match: /^first[-_]?name$/i, values: ['Sarah', 'James', 'Emily', 'Michael'] },
  { match: /^last[-_]?name$/i, values: ['Johnson', 'Wilson', 'Chen', 'Park'] },
  { match: /^display[-_]?name$/i, values: ['Sarah J.', 'James W.', 'Emily C.', 'Michael P.'] },

  // Labels / text content
  { match: /^label$|^text$|^caption$/i, values: ['Save changes', 'Submit', 'Learn more', 'Get started'] },
  { match: /^title$/i, values: ['Welcome to Our Store', 'Featured Products', 'Today\'s Deals', 'New Arrivals'] },
  { match: /^subtitle$|^subheading$/i, values: ['Discover something new today', 'Hand-picked just for you', 'Limited time offers', 'Fresh and trending'] },
  { match: /^heading$/i, values: ['Getting Started', 'How It Works', 'Our Mission', 'Why Choose Us'] },
  { match: /^description$|^desc$|^summary$|^body$/i, values: ['A short description of this item that gives context to the reader.', 'Learn more about our products and services.', 'Explore our latest collection of curated items.', 'Find everything you need in one place.'] },
  { match: /^content$/i, values: ['Here is some example content that demonstrates the component.', 'This is a sample paragraph.', 'Content goes here.', 'Example text for preview.'] },
  { match: /^message$/i, values: ['Your changes have been saved successfully.', 'Something went wrong. Please try again.', 'Welcome back!', 'Operation completed.'] },

  // CTA / buttons
  { match: /^cta[-_]?text$|^button[-_]?text$|^action[-_]?text$/i, values: ['Shop Now', 'Get Started', 'Learn More', 'Sign Up Free'] },

  // Contact
  { match: /^email$/i, values: ['sarah@example.com', 'james@example.com', 'hello@company.com', 'support@app.com'] },
  { match: /^phone$/i, values: ['+1 (555) 123-4567', '+1 (555) 987-6543', '+1 (555) 246-8135', '+1 (555) 369-2580'] },

  // URL / media
  { match: /^(image|img|photo|avatar|src|thumbnail)[-_]?(url|src)?$/i, values: ['https://picsum.photos/200/300', 'https://picsum.photos/400/300', 'https://picsum.photos/300/300', 'https://picsum.photos/500/300'] },
  { match: /^url$|^href$|^link$/i, values: ['https://example.com', 'https://example.com/about', 'https://example.com/products', 'https://example.com/contact'] },
  { match: /^icon$/i, values: ['star', 'heart', 'check', 'info'] },

  // Search
  { match: /^placeholder$/i, values: ['Search products, brands, and more...', 'Type to search...', 'What are you looking for?', 'Search...'] },
  { match: /^query$|^search[-_]?(value|text|term)$|^keyword$/i, values: ['organic coffee', 'running shoes', 'wireless headphones', 'protein bars'] },

  // Identity
  { match: /^id$/i, values: ['prod_001', 'usr_42', 'item_123', 'order_789'] },
  { match: /^category$/i, values: ['Fresh Produce', 'Beverages', 'Snacks', 'Dairy'] },
  { match: /^tag$|^badge$/i, values: ['New', 'Popular', 'Sale', 'Featured'] },
  { match: /^status$/i, values: ['active', 'pending', 'completed', 'cancelled'] },
  { match: /^type$|^kind$|^variant$/i, values: ['primary', 'secondary', 'outline', 'ghost'] },
  { match: /^size$/i, values: ['md', 'sm', 'lg', 'xl'] },
  { match: /^color$|^colour$/i, values: ['#3B82F6', '#EF4444', '#10B981', '#F59E0B'] },
  { match: /^background[-_]?(color|gradient)?$/i, values: ['linear-gradient(135deg, #667eea 0%, #764ba2 100%)', '#f8fafc', 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', '#1e293b'] },

  // Emoji (contextual)
  { match: /^emoji$|^icon[-_]?emoji$/i, values: ['🛒', '⭐', '🎉', '🔥'] },

  // Date/time
  { match: /^date$|^created[-_]?at$|^updated[-_]?at$/i, values: ['2026-03-15', '2026-02-28', '2026-01-10', '2025-12-01'] },
  { match: /^time$/i, values: ['10:30 AM', '2:15 PM', '9:00 AM', '5:45 PM'] },
];

function inferStringValue(name: string, desc: string, context: ComponentContext, variantIndex: number): string {
  // Context-aware: `name` prop means different things per component type
  if (/^name$/i.test(name)) {
    switch (context) {
      case 'product': return ['Organic Avocados', 'Greek Yogurt Pack', 'Cold Brew Coffee', 'Trail Mix'][variantIndex % 4];
      case 'cart': return ['Organic Avocados', 'Oat Milk', 'Sourdough Bread', 'Fresh Berries'][variantIndex % 4];
      case 'card': return ['Fresh Produce', 'Beverages', 'Snacks', 'Dairy'][variantIndex % 4];
      case 'user': return ['Sarah Johnson', 'James Wilson', 'Emily Chen', 'Michael Park'][variantIndex % 4];
      case 'badge': return ['Active', 'Pending', 'New', 'Featured'][variantIndex % 4];
      default: return ['Item Name', 'Example Name', 'Sample Item', 'Test Entry'][variantIndex % 4];
    }
  }

  // Context-aware: `image` prop — use emojis for product/cart contexts, URLs otherwise
  if (/^(image|img|photo|thumbnail)$/i.test(name)) {
    if (desc.includes('emoji') || context === 'product' || context === 'cart' || context === 'card') {
      return ['🥑', '🥛', '☕', '🥜'][variantIndex % 4];
    }
    return ['https://picsum.photos/200/300', 'https://picsum.photos/400/300', 'https://picsum.photos/300/300', 'https://picsum.photos/500/300'][variantIndex % 4];
  }

  // Check patterns against prop name
  for (const { match, values } of STRING_PATTERNS) {
    if (match.test(name)) {
      return values[variantIndex % values.length];
    }
  }

  // Check description keywords
  if (desc.includes('email')) return ['sarah@example.com', 'james@example.com'][variantIndex % 2];
  if (desc.includes('url') || desc.includes('link')) return 'https://example.com';
  if (desc.includes('emoji')) return ['🛒', '🥬', '🎉', '☕'][variantIndex % 4];

  // Context-based fallback
  switch (context) {
    case 'product': return ['Organic Avocados', 'Fresh Berries', 'Almond Milk', 'Whole Grain Bread'][variantIndex % 4];
    case 'cart': return ['Shopping Cart', 'Your Items', 'Order Summary', 'Checkout'][variantIndex % 4];
    case 'user': return ['Sarah Johnson', 'James Wilson', 'Emily Chen', 'Michael Park'][variantIndex % 4];
    case 'search': return ['Search...', 'Find products...', 'What are you looking for?', 'Type to search...'][variantIndex % 4];
    case 'hero': return ['Welcome to Our Store', 'Discover Amazing Deals', 'Shop the Latest', 'Free Delivery Today'][variantIndex % 4];
    case 'banner': return ['Limited Time Offer', 'Free Shipping', 'New Arrivals', 'Special Promotion'][variantIndex % 4];
    case 'button': return ['Save changes', 'Submit', 'Continue', 'Get started'][variantIndex % 4];
    case 'badge': return ['Active', 'Pending', 'New', 'Featured'][variantIndex % 4];
    case 'alert': return ['Operation completed successfully.', 'Please try again.', 'Are you sure?', 'Item has been saved.'][variantIndex % 4];
    default: return ['Example text', 'Sample content', 'Demo value', 'Placeholder'][variantIndex % 4];
  }
}

// ---------------------------------------------------------------------------
// Number inference
// ---------------------------------------------------------------------------

function inferNumberValue(name: string, desc: string, context: ComponentContext, variantIndex: number): number {
  const n = name.toLowerCase();
  if (n === 'originalprice' || n === 'original_price' || n === 'msrp' || n === 'was_price') {
    return [12.99, 19.99, 29.99, 7.99][variantIndex % 4];
  }
  if (n.includes('price') || n.includes('cost') || n.includes('amount') || n.includes('total')) {
    return [9.99, 14.99, 24.99, 4.49][variantIndex % 4];
  }
  if (n.includes('count') || n.includes('quantity') || n.includes('qty')) {
    return [3, 5, 12, 1][variantIndex % 4];
  }
  if (n.includes('rating') || n.includes('score')) {
    return [4.5, 3.8, 5.0, 4.2][variantIndex % 4];
  }
  if (n === 'id') {
    return variantIndex + 1;
  }
  if (n.includes('age')) {
    return [28, 35, 42, 19][variantIndex % 4];
  }
  if (n.includes('percent') || n.includes('progress')) {
    return [75, 50, 100, 25][variantIndex % 4];
  }
  if (n.includes('max') || n.includes('limit')) return 100;
  if (n.includes('min')) return 0;
  if (n.includes('step')) return 1;
  if (n.includes('width') || n.includes('height')) return [320, 480, 640, 200][variantIndex % 4];
  if (n.includes('delay') || n.includes('duration') || n.includes('timeout')) return 3000;

  return [42, 7, 128, 15][variantIndex % 4];
}

// ---------------------------------------------------------------------------
// Boolean inference
// ---------------------------------------------------------------------------

function inferBooleanValue(name: string, desc: string, variantIndex: number): boolean {
  // Props that should default to true for a meaningful preview
  if (/^(is[-_]?open|visible|show|active|enabled|checked|selected|expanded)$/i.test(name)) {
    return variantIndex === 0 ? true : variantIndex % 2 === 0;
  }
  // Props that should default to false
  if (/^(disabled|loading|readonly|read[-_]?only|error|hidden|collapsed)$/i.test(name)) {
    return variantIndex > 0 && variantIndex % 2 === 0;
  }
  return variantIndex % 2 === 0;
}

// ---------------------------------------------------------------------------
// Array inference
// ---------------------------------------------------------------------------

function inferArrayValue(prop: PropMeta, context: ComponentContext): unknown[] {
  const name = prop.name.toLowerCase();
  const type = prop.typeName;

  // Known patterns — return sample data
  if (name === 'items' && (context === 'faq' || /FAQ/i.test(type))) {
    return [
      { question: 'How fast is delivery?', answer: 'Most orders arrive within 30 minutes.' },
      { question: 'Is there a minimum order?', answer: 'No minimum order. Orders under $10 have a $2.99 fee.' },
      { question: 'Can I schedule a delivery?', answer: 'Yes, up to 7 days in advance.' },
    ];
  }
  if (name === 'items' && (context === 'cart' || /Cart/i.test(type))) {
    return [
      { id: 1, name: 'Organic Avocados', price: 4.99, quantity: 2, image: '🥑' },
      { id: 2, name: 'Oat Milk', price: 3.99, quantity: 1, image: '🥛' },
    ];
  }
  if (name.includes('product') || (name === 'items' && context === 'product')) {
    return [
      { id: 1, name: 'Organic Avocados', price: 4.99, image: '🥑', category: 'Produce' },
      { id: 2, name: 'Cold Brew Coffee', price: 3.99, image: '☕', category: 'Beverages' },
      { id: 3, name: 'Trail Mix', price: 5.49, image: '🥜', category: 'Snacks' },
    ];
  }
  if (name.includes('option') || name.includes('choice')) {
    return ['Option A', 'Option B', 'Option C'];
  }
  if (name.includes('tag') || name.includes('label')) {
    return ['Featured', 'New', 'Popular'];
  }

  // Generic — return empty array (safe default)
  return [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFunctionProp(typeName: string): boolean {
  return /^\s*\(.*\)\s*=>\s*\S/.test(typeName) || /^Function$/.test(typeName);
}

function stripNullable(typeName: string): string {
  return typeName.split('|').map((p) => p.trim()).filter((p) => p !== 'undefined' && p !== 'null').join(' | ').trim();
}

function isStringLiteralUnion(clean: string): boolean {
  return extractStringLiterals(clean).length > 0;
}

function extractStringLiterals(typeName: string): string[] {
  const parts = typeName.split('|').map((p) => p.trim());
  const literals: string[] = [];
  for (const part of parts) {
    const match = part.match(/^['"](.*)['"]$/);
    if (match) literals.push(match[1]);
  }
  return literals;
}
