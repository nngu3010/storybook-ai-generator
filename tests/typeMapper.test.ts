import { describe, it, expect } from 'vitest';
import { mapPropToArgType, getDefaultArg, isComponentTypeProp, isComponentRef } from '../src/mapper/typeMapper.js';
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
// mapPropToArgType — primitive types
// ---------------------------------------------------------------------------
describe('mapPropToArgType — primitive types', () => {
  it('maps string to text control', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'string' }));
    expect(result.control).toBe('text');
  });

  it('maps number to number control', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'number' }));
    expect(result.control).toBe('number');
  });

  it('maps boolean to boolean control', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'boolean' }));
    expect(result.control).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// mapPropToArgType — nullable stripping
// ---------------------------------------------------------------------------
describe('mapPropToArgType — nullable stripping', () => {
  it('strips "| undefined" before classifying string', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'string | undefined' }));
    expect(result.control).toBe('text');
  });

  it('strips "| null" before classifying number', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'number | null' }));
    expect(result.control).toBe('number');
  });

  it('strips both null and undefined before classifying boolean', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'boolean | null | undefined' }));
    expect(result.control).toBe('boolean');
  });

  it('strips undefined from string literal union', () => {
    const result = mapPropToArgType(makeProp({ typeName: "'primary' | 'secondary' | undefined" }));
    expect(result.control).toBe('select');
    expect(result.options).toEqual(['primary', 'secondary']);
  });
});

// ---------------------------------------------------------------------------
// mapPropToArgType — string literal unions
// ---------------------------------------------------------------------------
describe('mapPropToArgType — string literal unions', () => {
  it('maps string literal union to select control', () => {
    const result = mapPropToArgType(makeProp({ typeName: "'primary' | 'secondary' | 'danger'" }));
    expect(result.control).toBe('select');
    expect(result.options).toEqual(['primary', 'secondary', 'danger']);
  });

  it('maps two-value union to select', () => {
    const result = mapPropToArgType(makeProp({ typeName: "'on' | 'off'" }));
    expect(result.control).toBe('select');
    expect(result.options).toEqual(['on', 'off']);
  });

  it('maps three-value union with null stripped', () => {
    const result = mapPropToArgType(makeProp({ typeName: "'sm' | 'md' | 'lg' | null" }));
    expect(result.control).toBe('select');
    expect(result.options).toEqual(['sm', 'md', 'lg']);
  });
});

// ---------------------------------------------------------------------------
// mapPropToArgType — function types
// ---------------------------------------------------------------------------
describe('mapPropToArgType — function types', () => {
  it('maps () => void to action', () => {
    const result = mapPropToArgType(makeProp({ name: 'onClick', typeName: '() => void' }));
    expect(result.action).toBe('onClick');
    expect(result.control).toBeUndefined();
  });

  it('maps (value: string) => void to action', () => {
    const result = mapPropToArgType(makeProp({ name: 'onChange', typeName: '(value: string) => void' }));
    expect(result.action).toBe('onChange');
  });

  it('maps (event: React.MouseEvent) => void to action', () => {
    const result = mapPropToArgType(makeProp({ name: 'onMouseEnter', typeName: '(event: React.MouseEvent) => void' }));
    expect(result.action).toBe('onMouseEnter');
  });

  it('maps (item: T) => void to action', () => {
    const result = mapPropToArgType(makeProp({ name: 'onSelect', typeName: '(item: T) => void' }));
    expect(result.action).toBe('onSelect');
  });
});

// ---------------------------------------------------------------------------
// mapPropToArgType — ReactNode / ReactElement
// ---------------------------------------------------------------------------
describe('mapPropToArgType — ReactNode and ReactElement', () => {
  it('maps React.ReactNode to control false', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'React.ReactNode' }));
    expect(result.control).toBe(false);
  });

  it('maps ReactNode to control false', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'ReactNode' }));
    expect(result.control).toBe(false);
  });

  it('maps React.ReactElement to control false', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'React.ReactElement' }));
    expect(result.control).toBe(false);
  });

  it('maps ReactElement to control false', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'ReactElement' }));
    expect(result.control).toBe(false);
  });

  it('maps ReactNode | undefined to control false', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'React.ReactNode | undefined' }));
    expect(result.control).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mapPropToArgType — CSSProperties
// ---------------------------------------------------------------------------
describe('mapPropToArgType — CSSProperties', () => {
  it('maps CSSProperties to object control', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'React.CSSProperties' }));
    expect(result.control).toBe('object');
  });

  it('maps bare CSSProperties to object control', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'CSSProperties' }));
    expect(result.control).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// mapPropToArgType — array types
// ---------------------------------------------------------------------------
describe('mapPropToArgType — array types', () => {
  it('maps string[] to object control', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'string[]' }));
    expect(result.control).toBe('object');
  });

  it('maps Array<string> to object control', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'Array<string>' }));
    expect(result.control).toBe('object');
  });

  it('maps complex T[] to object control', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'MyOption[]' }));
    expect(result.control).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// mapPropToArgType — fallback / complex types
// ---------------------------------------------------------------------------
describe('mapPropToArgType — fallback types', () => {
  it('maps unknown object type to object control', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'MyComplexType' }));
    expect(result.control).toBe('object');
  });

  it('maps Record<string, unknown> to object control', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'Record<string, unknown>' }));
    expect(result.control).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// mapPropToArgType — deprecated props
// ---------------------------------------------------------------------------
describe('mapPropToArgType — deprecated props', () => {
  it('sets table.disable true for deprecated prop', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'string', deprecated: true }));
    expect(result.table).toEqual({ disable: true });
  });

  it('does not set table.disable for non-deprecated prop', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'string', deprecated: false }));
    expect(result.table).toBeUndefined();
  });

  it('still maps control type correctly for deprecated prop', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'boolean', deprecated: true }));
    expect(result.control).toBe('boolean');
    expect(result.table).toEqual({ disable: true });
  });
});

// ---------------------------------------------------------------------------
// mapPropToArgType — description forwarding
// ---------------------------------------------------------------------------
describe('mapPropToArgType — description forwarding', () => {
  it('forwards description to argType', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'string', description: 'The label text' }));
    expect(result.description).toBe('The label text');
  });

  it('forwards defaultValue to argType', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'string', defaultValue: 'Click me' }));
    expect(result.defaultValue).toBe('Click me');
  });

  it('forwards prop name to argType', () => {
    const result = mapPropToArgType(makeProp({ name: 'myLabel', typeName: 'string' }));
    expect(result.name).toBe('myLabel');
  });
});

// ---------------------------------------------------------------------------
// getDefaultArg
// ---------------------------------------------------------------------------
describe('getDefaultArg', () => {
  it('returns empty string for string type', () => {
    expect(getDefaultArg(makeProp({ typeName: 'string' }))).toBe('');
  });

  it('returns 0 for number type', () => {
    expect(getDefaultArg(makeProp({ typeName: 'number' }))).toBe(0);
  });

  it('returns false for boolean type', () => {
    expect(getDefaultArg(makeProp({ typeName: 'boolean' }))).toBe(false);
  });

  it('returns the first literal for string literal union', () => {
    expect(getDefaultArg(makeProp({ typeName: "'primary' | 'secondary' | 'danger'" }))).toBe('primary');
  });

  it('returns undefined for ReactNode', () => {
    expect(getDefaultArg(makeProp({ typeName: 'React.ReactNode' }))).toBeUndefined();
  });

  it('uses explicit defaultValue over type inference', () => {
    expect(getDefaultArg(makeProp({ typeName: 'string', defaultValue: 'hello' }))).toBe('hello');
  });

  it('strips quotes from ts-morph quoted string defaults', () => {
    expect(getDefaultArg(makeProp({ typeName: 'string', defaultValue: "'primary'" }))).toBe('primary');
  });

  it('parses boolean true default', () => {
    expect(getDefaultArg(makeProp({ typeName: 'boolean', defaultValue: 'true' }))).toBe(true);
  });

  it('parses boolean false default', () => {
    expect(getDefaultArg(makeProp({ typeName: 'boolean', defaultValue: 'false' }))).toBe(false);
  });

  it('returns undefined for function types', () => {
    expect(getDefaultArg(makeProp({ typeName: '() => void' }))).toBeUndefined();
  });

  it('returns empty string for "string | undefined"', () => {
    expect(getDefaultArg(makeProp({ typeName: 'string | undefined' }))).toBe('');
  });

  it('returns undefined for LucideIcon', () => {
    expect(getDefaultArg(makeProp({ typeName: 'LucideIcon' }))).toBeUndefined();
  });

  it('returns undefined for ComponentType', () => {
    expect(getDefaultArg(makeProp({ typeName: 'React.ComponentType<any>' }))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mapPropToArgType — component type props
// ---------------------------------------------------------------------------
describe('mapPropToArgType — component type props', () => {
  it('maps LucideIcon to control false', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'LucideIcon' }));
    expect(result.control).toBe(false);
  });

  it('maps React.ComponentType to control false', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'React.ComponentType<any>' }));
    expect(result.control).toBe(false);
  });

  it('maps FC to control false', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'FC<IconProps>' }));
    expect(result.control).toBe(false);
  });

  it('maps ForwardRefExoticComponent to control false', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'ForwardRefExoticComponent<SVGProps>' }));
    expect(result.control).toBe(false);
  });

  it('maps IconType to control false', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'IconType' }));
    expect(result.control).toBe(false);
  });

  it('maps LucideIcon | undefined to control false', () => {
    const result = mapPropToArgType(makeProp({ typeName: 'LucideIcon | undefined' }));
    expect(result.control).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isComponentTypeProp
// ---------------------------------------------------------------------------
describe('isComponentTypeProp', () => {
  it('returns true for LucideIcon', () => {
    expect(isComponentTypeProp('LucideIcon')).toBe(true);
  });

  it('returns true for React.ComponentType<T>', () => {
    expect(isComponentTypeProp('React.ComponentType<IconProps>')).toBe(true);
  });

  it('returns true for FC<T>', () => {
    expect(isComponentTypeProp('FC<SvgProps>')).toBe(true);
  });

  it('returns true for nullable component types', () => {
    expect(isComponentTypeProp('LucideIcon | undefined')).toBe(true);
  });

  it('returns false for string', () => {
    expect(isComponentTypeProp('string')).toBe(false);
  });

  it('returns false for generic object types', () => {
    expect(isComponentTypeProp('MyCustomType')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isComponentRef
// ---------------------------------------------------------------------------
describe('isComponentRef', () => {
  it('returns true for a valid ComponentRef', () => {
    expect(isComponentRef({ __componentRef: true, importName: 'Circle', importSource: 'lucide-react' })).toBe(true);
  });

  it('returns false for a plain object', () => {
    expect(isComponentRef({ name: 'Circle' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isComponentRef(null)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isComponentRef('Circle')).toBe(false);
  });
});
