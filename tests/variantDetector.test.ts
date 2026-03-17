import { describe, it, expect } from 'vitest';
import { detectVariantProp, generateVariantStories } from '../src/mapper/variantDetector.js';
import type { PropMeta } from '../src/parser/componentParser.js';

function makeProp(overrides: Partial<PropMeta>): PropMeta {
  return {
    name: 'testProp',
    typeName: 'string',
    required: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectVariantProp — priority ordering
// ---------------------------------------------------------------------------
describe('detectVariantProp — priority', () => {
  it('prefers "variant" prop over others', () => {
    const props: PropMeta[] = [
      makeProp({ name: 'size', typeName: "'sm' | 'md' | 'lg'" }),
      makeProp({ name: 'variant', typeName: "'primary' | 'secondary' | 'danger'" }),
      makeProp({ name: 'kind', typeName: "'solid' | 'outline'" }),
    ];
    const result = detectVariantProp(props);
    expect(result?.name).toBe('variant');
  });

  it('prefers "type" over "kind" and "size"', () => {
    const props: PropMeta[] = [
      makeProp({ name: 'size', typeName: "'sm' | 'md' | 'lg'" }),
      makeProp({ name: 'kind', typeName: "'a' | 'b'" }),
      makeProp({ name: 'type', typeName: "'text' | 'email' | 'password'" }),
    ];
    const result = detectVariantProp(props);
    expect(result?.name).toBe('type');
  });

  it('prefers "kind" over "size"', () => {
    const props: PropMeta[] = [
      makeProp({ name: 'size', typeName: "'sm' | 'md' | 'lg'" }),
      makeProp({ name: 'kind', typeName: "'solid' | 'outline' | 'ghost'" }),
    ];
    const result = detectVariantProp(props);
    expect(result?.name).toBe('kind');
  });

  it('falls back to "size" when no higher-priority prop exists', () => {
    const props: PropMeta[] = [
      makeProp({ name: 'size', typeName: "'sm' | 'md' | 'lg'" }),
      makeProp({ name: 'label', typeName: 'string' }),
      makeProp({ name: 'disabled', typeName: 'boolean' }),
    ];
    const result = detectVariantProp(props);
    expect(result?.name).toBe('size');
  });

  it('returns the first union prop when no priority match', () => {
    const props: PropMeta[] = [
      makeProp({ name: 'label', typeName: 'string' }),
      makeProp({ name: 'status', typeName: "'active' | 'inactive' | 'pending'" }),
      makeProp({ name: 'count', typeName: 'number' }),
    ];
    const result = detectVariantProp(props);
    expect(result?.name).toBe('status');
  });
});

// ---------------------------------------------------------------------------
// detectVariantProp — filtering
// ---------------------------------------------------------------------------
describe('detectVariantProp — filtering', () => {
  it('returns undefined when no string literal union props exist', () => {
    const props: PropMeta[] = [
      makeProp({ name: 'label', typeName: 'string' }),
      makeProp({ name: 'count', typeName: 'number' }),
      makeProp({ name: 'disabled', typeName: 'boolean' }),
      makeProp({ name: 'onClick', typeName: '() => void' }),
    ];
    expect(detectVariantProp(props)).toBeUndefined();
  });

  it('returns undefined for empty props array', () => {
    expect(detectVariantProp([])).toBeUndefined();
  });

  it('excludes props with more than 6 options (too many variants)', () => {
    const props: PropMeta[] = [
      makeProp({
        name: 'color',
        typeName: "'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'indigo' | 'violet'",
      }),
    ];
    // 7 options > MAX_VARIANT_OPTIONS(6)
    expect(detectVariantProp(props)).toBeUndefined();
  });

  it('includes props with exactly 6 options', () => {
    const props: PropMeta[] = [
      makeProp({
        name: 'variant',
        typeName: "'a' | 'b' | 'c' | 'd' | 'e' | 'f'",
      }),
    ];
    const result = detectVariantProp(props);
    expect(result?.name).toBe('variant');
  });

  it('excludes props with only 1 option', () => {
    const props: PropMeta[] = [
      makeProp({ name: 'variant', typeName: "'primary'" }),
    ];
    expect(detectVariantProp(props)).toBeUndefined();
  });

  it('handles nullable union props by stripping undefined', () => {
    const props: PropMeta[] = [
      makeProp({ name: 'variant', typeName: "'primary' | 'secondary' | undefined" }),
    ];
    const result = detectVariantProp(props);
    expect(result?.name).toBe('variant');
  });
});

// ---------------------------------------------------------------------------
// generateVariantStories
// ---------------------------------------------------------------------------
describe('generateVariantStories', () => {
  it('generates a story for each literal value', () => {
    const prop = makeProp({ name: 'variant', typeName: "'primary' | 'secondary' | 'danger'" });
    const stories = generateVariantStories(prop);
    expect(stories).toHaveLength(3);
  });

  it('capitalises story names', () => {
    const prop = makeProp({ name: 'variant', typeName: "'primary' | 'secondary' | 'danger'" });
    const stories = generateVariantStories(prop);
    expect(stories[0].name).toBe('Primary');
    expect(stories[1].name).toBe('Secondary');
    expect(stories[2].name).toBe('Danger');
  });

  it('preserves the original value (not capitalised) in the value field', () => {
    const prop = makeProp({ name: 'size', typeName: "'sm' | 'md' | 'lg'" });
    const stories = generateVariantStories(prop);
    expect(stories[0].value).toBe('sm');
    expect(stories[1].value).toBe('md');
    expect(stories[2].value).toBe('lg');
  });

  it('limits to 6 stories max', () => {
    const prop = makeProp({
      name: 'color',
      typeName: "'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h'",
    });
    const stories = generateVariantStories(prop);
    expect(stories.length).toBeLessThanOrEqual(6);
  });

  it('returns empty array for prop with no string literals', () => {
    const prop = makeProp({ name: 'label', typeName: 'string' });
    const stories = generateVariantStories(prop);
    expect(stories).toHaveLength(0);
  });

  it('returns story objects with name and value keys', () => {
    const prop = makeProp({ name: 'variant', typeName: "'primary' | 'secondary'" });
    const stories = generateVariantStories(prop);
    for (const story of stories) {
      expect(story).toHaveProperty('name');
      expect(story).toHaveProperty('value');
      expect(typeof story.name).toBe('string');
      expect(typeof story.value).toBe('string');
    }
  });

  it('handles two-value variant prop', () => {
    const prop = makeProp({ name: 'variant', typeName: "'on' | 'off'" });
    const stories = generateVariantStories(prop);
    expect(stories).toHaveLength(2);
    expect(stories[0]).toEqual({ name: 'On', value: 'on' });
    expect(stories[1]).toEqual({ name: 'Off', value: 'off' });
  });
});

// ---------------------------------------------------------------------------
// Integration: detect + generate
// ---------------------------------------------------------------------------
describe('detectVariantProp + generateVariantStories integration', () => {
  it('finds variant prop and generates correct stories for Button-like component', () => {
    const props: PropMeta[] = [
      makeProp({ name: 'label', typeName: 'string', required: true }),
      makeProp({ name: 'variant', typeName: "'primary' | 'secondary' | 'danger'" }),
      makeProp({ name: 'size', typeName: "'sm' | 'md' | 'lg'" }),
      makeProp({ name: 'disabled', typeName: 'boolean' }),
      makeProp({ name: 'onClick', typeName: '() => void' }),
    ];

    const variantProp = detectVariantProp(props);
    expect(variantProp?.name).toBe('variant');

    const stories = generateVariantStories(variantProp!);
    expect(stories.map((s) => s.value)).toEqual(['primary', 'secondary', 'danger']);
    expect(stories.map((s) => s.name)).toEqual(['Primary', 'Secondary', 'Danger']);
  });

  it('correctly handles Input-like component with type prop', () => {
    const props: PropMeta[] = [
      makeProp({ name: 'value', typeName: 'string', required: true }),
      makeProp({ name: 'onChange', typeName: '(value: string) => void', required: true }),
      makeProp({ name: 'type', typeName: "'text' | 'email' | 'password'" }),
      makeProp({ name: 'error', typeName: 'string | undefined' }),
    ];

    const variantProp = detectVariantProp(props);
    expect(variantProp?.name).toBe('type');

    const stories = generateVariantStories(variantProp!);
    expect(stories).toHaveLength(3);
    expect(stories[0].value).toBe('text');
    expect(stories[1].value).toBe('email');
    expect(stories[2].value).toBe('password');
  });
});
