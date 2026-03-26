import type { ComponentMeta, PropMeta } from '../parser/componentParser.js';
import { extractStringLiterals } from '../utils/stringLiterals.js';
import { getDefaultArg, isComponentTypeProp, isReactNodeType, type ComponentRef } from '../mapper/typeMapper.js';
import { detectVariantProp, generateVariantStories } from '../mapper/variantDetector.js';
import type { AiStoryArgs } from './argGenerator.js';
import type { ProjectContext } from '../mcp/contextScanner.js';
import { extractArgsFromUsages, type ExtractedUsageArgs } from './usageExtractor.js';
import { extractValuesFromDataFiles, mergeExtracted } from './dataExtractor.js';
import type { ResolvedTypeDefinition } from '../parser/typeResolver.js';
import { applyPropRelationships } from './propRelationships.js';

/**
 * Generates realistic arg values using keyword heuristics — no API key needed.
 * Analyses component name, prop names, JSDoc descriptions, and types to pick
 * semantically appropriate values.
 */
export function generateHeuristicArgs(
  meta: ComponentMeta,
  projectContext?: ProjectContext,
  resolvedTypes?: Map<string, ResolvedTypeDefinition>,
): AiStoryArgs {
  const variantProp = detectVariantProp(meta.props);
  const variantStories = variantProp ? generateVariantStories(variantProp) : [];

  const context = inferContext(meta.name);
  const fromUsage = projectContext
    ? extractArgsFromUsages(projectContext.componentUsages, meta.props)
    : {};
  const fromData = projectContext
    ? extractValuesFromDataFiles(projectContext.mockDataFiles, meta.props)
    : {};
  const extracted = mergeExtracted(fromUsage, fromData);
  const defaultArgs: Record<string, unknown> = {};

  for (const prop of meta.props) {
    if (isFunctionProp(prop.typeName)) continue;
    defaultArgs[prop.name] = inferValue(prop, context, 0, extracted, resolvedTypes);
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
        variantArgs[prop.name] = inferValue(prop, context, i + 1, extracted, resolvedTypes);
      }
    }
    variants[vs.name] = variantArgs;
  }

  return {
    Default: applyPropRelationships(defaultArgs, meta.props),
    variants: Object.fromEntries(
      Object.entries(variants).map(([k, v]) => [k, applyPropRelationships(v, meta.props)])
    ),
  };
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

function inferValue(
  prop: PropMeta,
  context: ComponentContext,
  variantIndex: number,
  extracted: ExtractedUsageArgs = {},
  resolvedTypes?: Map<string, ResolvedTypeDefinition>,
): unknown {
  // Priority: real values extracted from codebase usage
  const usageValues = extracted[prop.name];
  if (usageValues && usageValues.length > 0) {
    return coerceUsageValue(usageValues[variantIndex % usageValues.length], prop.typeName);
  }

  // Component-type props (LucideIcon, ComponentType, etc.) → return a safe default component ref
  if (isComponentTypeProp(prop.typeName)) {
    return inferComponentRef(prop);
  }

  // ReactNode-like props (children, header, footer, etc.) → return context-aware string content
  if (isReactNodeType(stripNullable(prop.typeName))) {
    return inferChildrenValue(prop.name, context, variantIndex);
  }

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
    const elementTypeName = extractArrayElementTypeName(clean);
    const resolvedElement = elementTypeName && resolvedTypes?.get(elementTypeName);
    return inferArrayValue(prop, context, resolvedElement || undefined);
  }

  // Record / object types — generate meaningful sample data based on prop name
  if (/^Record</.test(clean) || /^\{/.test(clean)) {
    const obj = inferObjectValue(prop, context);
    if (prop.accessedPaths && prop.accessedPaths.length > 0) {
      ensureAccessedPaths(obj, prop.accessedPaths);
    }
    return obj;
  }

  // Named interface/type references (not primitive, not union, not array)
  // These are complex object types like StoreInfo, BannerData, etc.
  if (isNamedObjectType(clean)) {
    const resolvedType = resolvedTypes?.get(clean);
    const obj = inferObjectValue(prop, context, resolvedType || undefined);
    // Ensure accessed paths exist in the generated object
    if (prop.accessedPaths && prop.accessedPaths.length > 0) {
      ensureAccessedPaths(obj, prop.accessedPaths);
    }
    return obj;
  }

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

function inferArrayValue(prop: PropMeta, context: ComponentContext, resolvedElementType?: ResolvedTypeDefinition): unknown[] {
  // If we have a resolved element type with properties, generate typed items
  if (resolvedElementType && resolvedElementType.kind === 'interface' && resolvedElementType.properties) {
    return [
      generateObjectFromResolvedType(resolvedElementType, 0),
      generateObjectFromResolvedType(resolvedElementType, 1),
    ];
  }

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
// ReactNode / children inference
// ---------------------------------------------------------------------------

/** Context-aware children content by prop name and component context. */
function inferChildrenValue(propName: string, context: ComponentContext, variantIndex: number): string {
  const name = propName.toLowerCase();

  // Prop-name-specific content (non-children ReactNode slots)
  if (name === 'header' || name === 'title') {
    return CHILDREN_BY_CONTEXT[context]?.header?.[variantIndex % 4]
      ?? ['Section Title', 'Overview', 'Details', 'Summary'][variantIndex % 4];
  }
  if (name === 'footer') {
    return CHILDREN_BY_CONTEXT[context]?.footer?.[variantIndex % 4]
      ?? ['View all', 'Learn more', 'See details', 'Read more'][variantIndex % 4];
  }
  if (name === 'label') {
    return ['Save changes', 'Submit', 'Continue', 'Get started'][variantIndex % 4];
  }
  if (name === 'icon' || name === 'prefix' || name === 'suffix') {
    return ['★', '→', '•', '✓'][variantIndex % 4];
  }
  if (name === 'description' || name === 'subtitle' || name === 'subheading') {
    return CHILDREN_BY_CONTEXT[context]?.description?.[variantIndex % 4]
      ?? ['A brief description of this item.', 'More details about this section.', 'Additional information here.', 'Summary of the content below.'][variantIndex % 4];
  }

  // Default: "children" prop or any other ReactNode prop — use context-aware body content
  return CHILDREN_BY_CONTEXT[context]?.body?.[variantIndex % 4]
    ?? ['Content goes here', 'Sample content for preview', 'Example text', 'Placeholder content'][variantIndex % 4];
}

const CHILDREN_BY_CONTEXT: Record<string, { body?: string[]; header?: string[]; footer?: string[]; description?: string[] }> = {
  button: {
    body: ['Save changes', 'Submit', 'Continue', 'Get started'],
  },
  card: {
    body: ['This is a sample card with some descriptive content about the item.', 'A brief overview of the featured content and key details.', 'Explore this item to learn more about what it offers.', 'Key highlights and important information at a glance.'],
    header: ['Featured Item', 'Product Details', 'Quick Overview', 'Highlights'],
    footer: ['View details', 'Learn more', 'See all', 'Read more'],
    description: ['A short summary of the card content.', 'Key details and highlights.', 'Everything you need to know.', 'Quick overview of this item.'],
  },
  modal: {
    body: ['Are you sure you want to proceed? This action cannot be undone.', 'Please review the details below before confirming.', 'Enter your information to continue.', 'Select an option to proceed with your request.'],
    header: ['Confirm Action', 'Edit Details', 'Create New Item', 'Delete Item'],
    footer: ['Cancel', 'Confirm', 'Save', 'Close'],
  },
  alert: {
    body: ['Your changes have been saved successfully.', 'Something went wrong. Please try again later.', 'Please review the highlighted fields before submitting.', 'Your session will expire in 5 minutes.'],
  },
  badge: {
    body: ['New', 'Popular', 'Sale', 'Featured'],
  },
  nav: {
    body: ['Home', 'Products', 'About', 'Contact'],
  },
  hero: {
    body: ['Discover amazing products curated just for you. Start exploring today.', 'The best deals on premium items, delivered to your door.', 'Join thousands of happy customers. Shop now and save big.', 'Your one-stop shop for everything you need.'],
    header: ['Welcome to Our Store', 'Discover Amazing Deals', 'Shop the Latest Collection', 'Free Delivery on All Orders'],
    description: ['Find everything you need in one place.', 'Curated collections for every occasion.', 'Quality products at unbeatable prices.', 'New arrivals added daily.'],
  },
  banner: {
    body: ['Limited time offer — save up to 50% on selected items!', 'Free shipping on all orders over $50.', 'New arrivals just dropped. Check them out!', 'Sign up today and get 20% off your first order.'],
  },
  product: {
    body: ['Fresh, organic, and locally sourced. Perfect for your daily meals.', 'Premium quality at an affordable price.', 'Our bestselling item — loved by thousands of customers.', 'Sustainably sourced and naturally delicious.'],
    description: ['100% organic and fresh', 'Premium quality product', 'Customer favorite', 'Sustainably sourced'],
  },
  input: {
    body: ['Enter your details', 'Type here...', 'Add your input', 'Fill in this field'],
  },
  table: {
    body: ['No data available. Try adjusting your filters.', 'Loading results...', 'Showing 1–10 of 42 results', 'Select rows to perform actions.'],
  },
  faq: {
    body: ['Click on a question to expand the answer.', 'Browse our frequently asked questions below.', 'Can\'t find what you\'re looking for? Contact us.', 'Updated answers to common questions.'],
  },
  generic: {
    body: ['Content goes here', 'Sample content for preview', 'Example text for this component', 'Placeholder content'],
    header: ['Section Title', 'Overview', 'Details', 'Summary'],
    footer: ['View all', 'Learn more', 'See details', 'Read more'],
    description: ['A brief description of this item.', 'More details about this section.', 'Additional information here.', 'Summary of the content below.'],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFunctionProp(typeName: string): boolean {
  return /^\s*\(.*\)\s*=>\s*\S/.test(typeName) || /^Function$/.test(typeName);
}

// ---------------------------------------------------------------------------
// Hint categorization — exposes heuristic intelligence to MCP clients
// ---------------------------------------------------------------------------

/**
 * Returns a semantic category hint for a prop based on its name, type,
 * and component context. Reuses STRING_PATTERNS + inferContext logic.
 */
export function categorizeHint(prop: PropMeta, componentName: string): string | undefined {
  const name = prop.name.toLowerCase();
  const clean = stripNullable(prop.typeName);

  // Function props
  if (isFunctionProp(clean)) return 'callback';

  // Component type props
  if (isComponentTypeProp(clean)) return 'component_ref';

  // ReactNode-like props (children, render slots)
  if (isReactNodeType(clean)) return 'react_node';

  // Boolean categories
  if (clean === 'boolean') {
    if (/disabled|loading|readonly|read[-_]?only|error/i.test(name)) return 'disabled_state';
    if (/open|visible|show|active|enabled|checked|selected|expanded/i.test(name)) return 'visibility_state';
    return 'toggle';
  }

  // Number categories
  if (clean === 'number') {
    if (/price|cost|amount|total|msrp/i.test(name)) return 'price';
    if (/count|quantity|qty/i.test(name)) return 'count';
    if (/rating|score/i.test(name)) return 'rating';
    if (/percent|progress/i.test(name)) return 'percentage';
    if (/width|height/i.test(name)) return 'dimension';
    if (/delay|duration|timeout/i.test(name)) return 'duration';
    return undefined;
  }

  // String literal union → variant selector
  if (isStringLiteralUnion(clean)) return 'variant_selector';

  // Array types
  if (/\[\]$/.test(clean) || /^Array</.test(clean)) return 'list_data';

  // Record / object types
  if (/^Record</.test(clean) || /^\{/.test(clean)) return 'object_data';

  // String categories — check patterns
  if (clean === 'string') {
    for (const { match } of STRING_PATTERNS) {
      if (match.test(name)) {
        // Derive category from pattern
        if (/email/i.test(match.source)) return 'email';
        if (/phone/i.test(match.source)) return 'phone';
        if (/url|href|link|src/i.test(match.source)) return 'url';
        if (/image|img|photo|avatar|thumbnail/i.test(match.source)) return 'image_url';
        if (/title|heading/i.test(match.source)) return 'title';
        if (/description|desc|summary|body|content/i.test(match.source)) return 'long_text';
        if (/label|text|caption/i.test(match.source)) return 'cta_text';
        if (/cta|button[-_]?text|action/i.test(match.source)) return 'cta_text';
        if (/name/i.test(match.source)) return 'person_name';
        if (/date|created|updated/i.test(match.source)) return 'date';
        if (/time$/i.test(match.source)) return 'time';
        if (/color|colour/i.test(match.source)) return 'color';
        if (/status/i.test(match.source)) return 'status';
        if (/placeholder/i.test(match.source)) return 'placeholder';
        if (/id$/i.test(match.source)) return 'identifier';
        if (/category/i.test(match.source)) return 'category';
        if (/tag|badge/i.test(match.source)) return 'tag';
        if (/size/i.test(match.source)) return 'size';
        if (/type|kind|variant/i.test(match.source)) return 'variant_selector';
        if (/icon/i.test(match.source)) return 'icon_name';
        if (/query|search|keyword/i.test(match.source)) return 'search_query';
        if (/message/i.test(match.source)) return 'message';
        if (/subtitle|subheading/i.test(match.source)) return 'subtitle';
        if (/emoji/i.test(match.source)) return 'emoji';
        if (/background/i.test(match.source)) return 'color';
      }
    }

    // Context-aware name prop
    if (/^name$/i.test(name)) {
      const ctx = inferContext(componentName);
      if (ctx === 'user') return 'person_name';
      if (ctx === 'product' || ctx === 'cart' || ctx === 'card') return 'product_name';
      return 'display_name';
    }

    // Context-aware image prop
    if (/^(image|img|photo|thumbnail)$/i.test(name)) return 'image_url';
  }

  return undefined;
}

function inferComponentRef(prop: PropMeta): ComponentRef {
  const name = prop.name.toLowerCase();
  const typeName = prop.typeName;

  // LucideIcon → use lucide-react icons, chosen by prop name
  if (/\bLucideIcon\b/.test(typeName)) {
    if (name.includes('close') || name.includes('dismiss')) {
      return { __componentRef: true, importName: 'X', importSource: 'lucide-react' };
    }
    if (name.includes('search')) {
      return { __componentRef: true, importName: 'Search', importSource: 'lucide-react' };
    }
    if (name.includes('user') || name.includes('avatar')) {
      return { __componentRef: true, importName: 'User', importSource: 'lucide-react' };
    }
    if (name.includes('setting') || name.includes('config')) {
      return { __componentRef: true, importName: 'Settings', importSource: 'lucide-react' };
    }
    if (name.includes('arrow')) {
      return { __componentRef: true, importName: 'ArrowRight', importSource: 'lucide-react' };
    }
    if (name.includes('check') || name.includes('success')) {
      return { __componentRef: true, importName: 'Check', importSource: 'lucide-react' };
    }
    if (name.includes('warning') || name.includes('alert')) {
      return { __componentRef: true, importName: 'AlertTriangle', importSource: 'lucide-react' };
    }
    if (name.includes('info')) {
      return { __componentRef: true, importName: 'Info', importSource: 'lucide-react' };
    }
    if (name.includes('error') || name.includes('danger')) {
      return { __componentRef: true, importName: 'XCircle', importSource: 'lucide-react' };
    }
    // Default: Circle is always safe and visually neutral
    return { __componentRef: true, importName: 'Circle', importSource: 'lucide-react' };
  }

  // react-icons IconType
  if (/\bIconType\b/.test(typeName)) {
    return { __componentRef: true, importName: 'FiCircle', importSource: 'react-icons/fi' };
  }

  // Generic ComponentType / FC / ElementType — use a safe lucide icon as fallback
  return { __componentRef: true, importName: 'Circle', importSource: 'lucide-react' };
}

/** Coerce a string extracted from JSX usage to the prop's expected type. */
function coerceUsageValue(value: string, typeName: string): unknown {
  const clean = stripNullable(typeName);
  if (clean === 'number') {
    const num = Number(value);
    return Number.isNaN(num) ? value : num;
  }
  if (clean === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }
  return value;
}

function stripNullable(typeName: string): string {
  return typeName.split('|').map((p) => p.trim()).filter((p) => p !== 'undefined' && p !== 'null').join(' | ').trim();
}

function isStringLiteralUnion(clean: string): boolean {
  return extractStringLiterals(clean).length > 0;
}

// ---------------------------------------------------------------------------
// Object/interface inference
// ---------------------------------------------------------------------------

/**
 * Checks if a type name represents a named object type (interface/type alias)
 * rather than a primitive, union, array, or function.
 */
function isNamedObjectType(clean: string): boolean {
  // Skip primitives, string literal unions, arrays, functions
  if (['string', 'number', 'boolean', 'any', 'unknown', 'never', 'void', 'null', 'undefined'].includes(clean)) return false;
  if (/^['"]/.test(clean)) return false;  // string literal
  if (/\[\]$/.test(clean) || /^Array</.test(clean)) return false;
  if (/^\(/.test(clean)) return false;  // function type
  if (/^Record</.test(clean) || /^\{/.test(clean)) return false;  // already handled
  if (clean.includes(' | ') || clean.includes(' & ')) return false;  // unions/intersections
  if (/^(React\.|JSX\.)/.test(clean)) return false;  // React types

  // Must start with a capital letter (named type) or be an imported identifier
  return /^[A-Z]/.test(clean);
}

/**
 * Generates a meaningful object value for named types and Record/object types.
 * When a resolved type definition is available, generates values matching the actual interface.
 * Falls back to prop name and component context for realistic placeholder data.
 */
function inferObjectValue(prop: PropMeta, context: ComponentContext, resolvedType?: ResolvedTypeDefinition): Record<string, unknown> {
  // If we have a resolved type with properties, generate from the actual type definition
  if (resolvedType && resolvedType.kind === 'interface' && resolvedType.properties) {
    return generateObjectFromResolvedType(resolvedType, 0);
  }

  const name = prop.name.toLowerCase();
  const typeName = prop.typeName.toLowerCase();

  // Store / location related
  if (name.includes('store') || name.includes('location') || name.includes('address')) {
    return {
      id: 1,
      name: 'Downtown Store',
      address: '123 Main St',
      city: 'San Francisco',
      state: 'CA',
      zip: '94102',
    };
  }

  // Product / item related
  if (name.includes('product') || name.includes('item') || (name === 'data' && (context === 'product' || context === 'cart'))) {
    return {
      id: 1,
      name: 'Organic Avocados',
      price: 4.99,
      image: '🥑',
      category: 'Produce',
    };
  }

  // User / customer / account
  if (name.includes('user') || name.includes('customer') || name.includes('account') || name.includes('profile')) {
    return {
      id: 1,
      name: 'Sarah Johnson',
      email: 'sarah@example.com',
    };
  }

  // Order related
  if (name.includes('order')) {
    return {
      id: 'ORD-001',
      status: 'delivered',
      total: 29.97,
      items: 3,
    };
  }

  // Banner / offer / promo
  if (name.includes('banner') || name.includes('offer') || name.includes('promo')) {
    return {
      id: 1,
      title: 'Limited Time Offer',
      description: 'Save up to 50% on selected items',
      imageUrl: 'https://picsum.photos/800/400',
      link: '/offers',
    };
  }

  // Config / options / settings
  if (name.includes('config') || name.includes('options') || name.includes('settings')) {
    return {
      enabled: true,
      label: 'Default Configuration',
    };
  }

  // Schema / structured data
  if (name.includes('schema') || typeName.includes('schema')) {
    return {
      '@type': 'Organization',
      name: 'Example Store',
      url: 'https://example.com',
    };
  }

  // Feedback / review
  if (name.includes('feedback') || name.includes('review')) {
    return {
      rating: 4.5,
      comment: 'Great product!',
      author: 'Sarah J.',
    };
  }

  // Generic object — generate based on context
  switch (context) {
    case 'cart':
      return { id: 1, name: 'Cart Item', price: 9.99, quantity: 1 };
    case 'product':
      return { id: 1, name: 'Product', price: 9.99, image: '🛒' };
    case 'user':
      return { id: 1, name: 'User', email: 'user@example.com' };
    default:
      return { id: 1, label: 'Example', value: 'sample' };
  }
}

// ---------------------------------------------------------------------------
// Type-aware object generation from resolved type definitions
// ---------------------------------------------------------------------------

/** Sample values for generating realistic data, indexed by variant */
const SAMPLE_STRINGS: Record<string, string[]> = {
  id: ['id-001', 'id-002', 'id-003'],
  name: ['Example Item', 'Sample Product', 'Test Entry'],
  title: ['Getting Started', 'Featured', 'New Arrival'],
  label: ['Primary', 'Secondary', 'Default'],
  description: ['A brief description of this item.', 'More details here.', 'Summary text.'],
  email: ['sarah@example.com', 'james@example.com', 'hello@company.com'],
  address: ['123 Main St', '456 Oak Ave', '789 Pine Rd'],
  street: ['123 Main St', '456 Oak Ave', '789 Pine Rd'],
  city: ['San Francisco', 'New York', 'Chicago'],
  state: ['CA', 'NY', 'IL'],
  zip: ['94102', '10001', '60601'],
  code: ['SAVE10', 'WELCOME', 'DEAL20'],
  url: ['https://example.com', 'https://example.com/about', 'https://example.com/products'],
  image: ['https://picsum.photos/200/300', 'https://picsum.photos/400/300', 'https://picsum.photos/300/300'],
  sku: ['SKU-001', 'SKU-002', 'SKU-003'],
  method: ['standard', 'express', 'overnight'],
  status: ['active', 'pending', 'completed'],
};

const SAMPLE_NUMBERS: Record<string, number[]> = {
  id: [1, 2, 3],
  price: [9.99, 14.99, 24.99],
  cost: [5.99, 8.99, 12.99],
  total: [29.97, 49.95, 99.99],
  subtotal: [24.97, 39.95, 84.99],
  tax: [2.50, 4.00, 7.50],
  discount: [5.00, 10.00, 15.00],
  quantity: [2, 5, 1],
  count: [3, 7, 12],
  weight: [0.5, 1.2, 2.0],
  width: [10, 20, 30],
  height: [15, 25, 35],
  depth: [5, 8, 12],
  rating: [4.5, 3.8, 5.0],
};

/**
 * Generate an object value by walking the resolved type definition's properties.
 * Uses property names to pick realistic sample values, delegating to the rich
 * STRING_PATTERNS and number heuristics for nested properties.
 */
function generateObjectFromResolvedType(resolved: ResolvedTypeDefinition, variantIndex: number): Record<string, unknown> {
  if (!resolved.properties) return {};

  const result: Record<string, unknown> = {};

  for (const [propName, prop] of Object.entries(resolved.properties)) {
    const typeText = prop.type.toLowerCase().trim();

    // Skip function-typed properties
    if (/^\s*\(.*\)\s*=>\s*\S/.test(prop.type) || typeText === 'function') {
      continue;
    }

    // Nested object with resolved type
    if (prop.resolved && prop.resolved.kind === 'interface' && prop.resolved.properties) {
      result[propName] = generateObjectFromResolvedType(prop.resolved, variantIndex);
      continue;
    }

    // Array with resolved element type
    if (prop.resolved && prop.resolved.kind === 'array' && prop.resolved.elementType) {
      const el = prop.resolved.elementType;
      if (el.kind === 'interface' && el.properties) {
        result[propName] = [
          generateObjectFromResolvedType(el, 0),
          generateObjectFromResolvedType(el, 1),
        ];
      } else if (el.kind === 'primitive') {
        const elText = (el.text ?? '').toLowerCase();
        if (elText.includes('string')) {
          result[propName] = ['item-1', 'item-2'];
        } else if (elText.includes('number')) {
          result[propName] = [1, 2, 3];
        } else {
          result[propName] = ['item-1', 'item-2'];
        }
      } else {
        result[propName] = ['item-1', 'item-2'];
      }
      continue;
    }

    // String literal union or enum
    if (prop.resolved && prop.resolved.kind === 'union' && prop.resolved.unionMembers) {
      const members = prop.resolved.unionMembers;
      const cleaned = members.map(m => m.replace(/^['"]|['"]$/g, ''));
      result[propName] = cleaned[variantIndex % cleaned.length];
      continue;
    }
    if (prop.resolved && prop.resolved.kind === 'enum' && prop.resolved.enumMembers) {
      result[propName] = prop.resolved.enumMembers[variantIndex % prop.resolved.enumMembers.length].value;
      continue;
    }

    // Primitives — use rich pattern-matching heuristics
    if (typeText.includes('string')) {
      result[propName] = inferNestedStringValue(propName, variantIndex);
      continue;
    }
    if (typeText.includes('number')) {
      result[propName] = inferNestedNumberValue(propName, variantIndex);
      continue;
    }
    if (typeText.includes('boolean')) {
      result[propName] = variantIndex === 0;
      continue;
    }

    // String array
    if (typeText === 'string[]' || typeText === 'array<string>') {
      result[propName] = ['item-1', 'item-2'];
      continue;
    }
    // Number array
    if (typeText === 'number[]' || typeText === 'array<number>') {
      result[propName] = [1, 2, 3];
      continue;
    }

    // Date types
    if (typeText.includes('date')) {
      result[propName] = '2026-03-15';
      continue;
    }

    // Fallback: descriptive string rather than undefined
    result[propName] = `Sample ${propName}`;
  }

  return result;
}

/**
 * Rich string value inference for nested properties.
 * Reuses STRING_PATTERNS (40+ regex patterns) before falling back.
 */
function inferNestedStringValue(propName: string, variantIndex: number): string {
  // Fast path: direct lookup
  const key = propName.toLowerCase();
  const samples = SAMPLE_STRINGS[key];
  if (samples) return samples[variantIndex % samples.length];

  // Full pattern matching from STRING_PATTERNS
  for (const { match, values } of STRING_PATTERNS) {
    if (match.test(propName)) {
      return values[variantIndex % values.length];
    }
  }

  // Name-based heuristics for common patterns not in STRING_PATTERNS
  if (key.includes('name')) return ['Example Item', 'Sample Product', 'Test Entry', 'Demo Widget'][variantIndex % 4];
  if (key.includes('text') || key.includes('content') || key.includes('body'))
    return ['Example content here.', 'Sample text for preview.', 'Demo content.', 'Placeholder text.'][variantIndex % 4];
  if (key.includes('slug')) return ['example-item', 'sample-product', 'test-entry', 'demo-widget'][variantIndex % 4];
  if (key.includes('key') || key.includes('token')) return ['key-001', 'key-002', 'key-003', 'key-004'][variantIndex % 4];
  if (key.includes('type') || key.includes('kind')) return ['default', 'primary', 'secondary', 'custom'][variantIndex % 4];
  if (key.includes('path') || key.includes('route')) return ['/home', '/products', '/about', '/contact'][variantIndex % 4];
  if (key.includes('currency')) return ['USD', 'EUR', 'GBP', 'AUD'][variantIndex % 4];
  if (key.includes('country')) return ['US', 'GB', 'AU', 'CA'][variantIndex % 4];
  if (key.includes('phone') || key.includes('mobile')) return ['+1 (555) 123-4567', '+1 (555) 987-6543'][variantIndex % 2];
  if (key.includes('format')) return ['default', 'compact', 'detailed', 'minimal'][variantIndex % 4];

  return `Sample ${propName}`;
}

/**
 * Rich number value inference for nested properties.
 * Reuses patterns from inferNumberValue for common number semantics.
 */
function inferNestedNumberValue(propName: string, variantIndex: number): number {
  const key = propName.toLowerCase();

  // Direct lookup
  const samples = SAMPLE_NUMBERS[key]
    ?? Object.entries(SAMPLE_NUMBERS).find(([k]) => key.endsWith(k))?.[1];
  if (samples) return samples[variantIndex % samples.length];

  // Pattern-based inference (mirrors inferNumberValue logic)
  if (key.includes('price') || key.includes('cost') || key.includes('amount') || key.includes('total'))
    return [9.99, 14.99, 24.99, 4.49][variantIndex % 4];
  if (key === 'originalprice' || key === 'original_price' || key === 'msrp' || key === 'was_price')
    return [12.99, 19.99, 29.99, 7.99][variantIndex % 4];
  if (key.includes('count') || key.includes('quantity') || key.includes('qty'))
    return [3, 5, 12, 1][variantIndex % 4];
  if (key.includes('rating') || key.includes('score'))
    return [4.5, 3.8, 5.0, 4.2][variantIndex % 4];
  if (key.includes('percent') || key.includes('progress'))
    return [75, 50, 100, 25][variantIndex % 4];
  if (key.includes('max') || key.includes('limit')) return 100;
  if (key.includes('min')) return 0;
  if (key.includes('step')) return 1;
  if (key.includes('width') || key.includes('height'))
    return [320, 480, 640, 200][variantIndex % 4];
  if (key.includes('delay') || key.includes('duration') || key.includes('timeout')) return 3000;
  if (key.includes('age')) return [28, 35, 42, 19][variantIndex % 4];
  if (key.includes('lat')) return [-37.8136, 40.7128, 51.5074, 35.6762][variantIndex % 4];
  if (key.includes('lng') || key.includes('lon'))
    return [144.9631, -74.0060, -0.1278, 139.6503][variantIndex % 4];

  return variantIndex + 1;
}

/**
 * Ensures that all accessed property paths exist in the generated object.
 * If a path like ['category', 'name'] is accessed, ensures obj.category.name exists.
 * Uses heuristic value inference for leaf properties based on the path segment name.
 */
function ensureAccessedPaths(obj: Record<string, unknown>, paths: string[][]): void {
  for (const path of paths) {
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < path.length; i++) {
      const segment = path[i];
      const isLast = i === path.length - 1;

      if (current[segment] === undefined || current[segment] === null) {
        if (isLast) {
          // Leaf — infer a value based on the segment name
          current[segment] = inferNestedStringValue(segment, 0);
        } else {
          // Branch — create nested object
          current[segment] = {};
        }
      }

      if (!isLast) {
        // Navigate into the nested object (only if it's an object)
        if (typeof current[segment] === 'object' && current[segment] !== null && !Array.isArray(current[segment])) {
          current = current[segment] as Record<string, unknown>;
        } else {
          // Can't navigate further (value exists but isn't an object)
          break;
        }
      }
    }
  }
}

/**
 * Extract the element type name from an array type string.
 * e.g., "CartItem[]" → "CartItem", "Array<Product>" → "Product"
 */
function extractArrayElementTypeName(typeStr: string): string | null {
  if (typeStr.endsWith('[]')) {
    const name = typeStr.slice(0, -2).trim();
    return /^[A-Z]/.test(name) ? name : null;
  }
  const match = typeStr.match(/^Array<(.+)>$/);
  if (match) {
    const name = match[1].trim();
    return /^[A-Z]/.test(name) ? name : null;
  }
  return null;
}
