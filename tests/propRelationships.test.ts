import { describe, it, expect } from 'vitest';
import { applyPropRelationships } from '../src/ai/propRelationships.js';
import type { PropMeta } from '../src/parser/componentParser.js';

describe('applyPropRelationships', () => {
  it('ensures originalPrice > price', () => {
    const props: PropMeta[] = [
      { name: 'price', typeName: 'number', required: true },
      { name: 'originalPrice', typeName: 'number', required: false },
    ];
    const args = { price: 9.99, originalPrice: 5.00 };
    const result = applyPropRelationships(args, props);
    expect(result.originalPrice).toBeGreaterThan(result.price as number);
  });

  it('leaves originalPrice alone when already > price', () => {
    const props: PropMeta[] = [
      { name: 'price', typeName: 'number', required: true },
      { name: 'originalPrice', typeName: 'number', required: false },
    ];
    const args = { price: 9.99, originalPrice: 19.99 };
    const result = applyPropRelationships(args, props);
    expect(result.originalPrice).toBe(19.99);
  });

  it('ensures salePrice < price', () => {
    const props: PropMeta[] = [
      { name: 'price', typeName: 'number', required: true },
      { name: 'salePrice', typeName: 'number', required: false },
    ];
    const args = { price: 9.99, salePrice: 15.00 };
    const result = applyPropRelationships(args, props);
    expect(result.salePrice).toBeLessThan(result.price as number);
  });

  it('ensures min < max', () => {
    const props: PropMeta[] = [
      { name: 'min', typeName: 'number', required: false },
      { name: 'max', typeName: 'number', required: false },
    ];
    const args = { min: 50, max: 30 };
    const result = applyPropRelationships(args, props);
    expect(result.max).toBeGreaterThan(result.min as number);
  });

  it('sets isOpen=true when onClose handler exists', () => {
    const props: PropMeta[] = [
      { name: 'isOpen', typeName: 'boolean', required: false },
      { name: 'onClose', typeName: '() => void', required: false },
    ];
    const args = { isOpen: false };
    const result = applyPropRelationships(args, props);
    expect(result.isOpen).toBe(true);
  });

  it('syncs itemCount with items array length', () => {
    const props: PropMeta[] = [
      { name: 'items', typeName: 'Product[]', required: true },
      { name: 'itemCount', typeName: 'number', required: false },
    ];
    const args = { items: [{ id: 1 }, { id: 2 }, { id: 3 }], itemCount: 99 };
    const result = applyPropRelationships(args, props);
    expect(result.itemCount).toBe(3);
  });

  it('does nothing when no correlated props exist', () => {
    const props: PropMeta[] = [
      { name: 'label', typeName: 'string', required: true },
      { name: 'disabled', typeName: 'boolean', required: false },
    ];
    const args = { label: 'Hello', disabled: false };
    const result = applyPropRelationships(args, props);
    expect(result).toEqual({ label: 'Hello', disabled: false });
  });

  it('handles minValue / maxValue pair', () => {
    const props: PropMeta[] = [
      { name: 'minValue', typeName: 'number', required: false },
      { name: 'maxValue', typeName: 'number', required: false },
    ];
    const args = { minValue: 100, maxValue: 50 };
    const result = applyPropRelationships(args, props);
    expect(result.maxValue).toBeGreaterThan(result.minValue as number);
  });
});
