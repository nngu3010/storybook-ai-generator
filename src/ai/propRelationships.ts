import type { PropMeta } from '../parser/componentParser.js';

/**
 * Apply semantic constraints to correlated props.
 * Ensures generated args are internally consistent
 * (e.g., originalPrice > price, min < max, count matches array length).
 */
export function applyPropRelationships(
  args: Record<string, unknown>,
  props: PropMeta[],
): Record<string, unknown> {
  const propNames = new Set(props.map(p => p.name));
  const result = { ...args };

  // Price pairs: originalPrice / wasPrice / msrp / compareAtPrice > price
  applyPricePair(result, propNames);

  // Min/max pairs
  applyMinMax(result, propNames);

  // State + handler pairs: if isOpen + onClose, set isOpen = true
  applyStateHandler(result, propNames);

  // Count + array pairs: itemCount matches array length
  applyCountArray(result, propNames);

  return result;
}

function applyPricePair(args: Record<string, unknown>, propNames: Set<string>): void {
  const priceKey = findProp(propNames, ['price']);
  if (!priceKey || typeof args[priceKey] !== 'number') return;

  const price = args[priceKey] as number;
  const higherPriceKeys = ['originalPrice', 'wasPrice', 'msrp', 'compareAtPrice', 'listPrice', 'regularPrice'];

  for (const key of higherPriceKeys) {
    if (propNames.has(key)) {
      if (typeof args[key] !== 'number' || (args[key] as number) <= price) {
        args[key] = Math.round((price * 1.3 + 0.01) * 100) / 100;
      }
    }
  }

  // Also handle salePrice < price
  const lowerPriceKeys = ['salePrice', 'discountPrice'];
  for (const key of lowerPriceKeys) {
    if (propNames.has(key)) {
      if (typeof args[key] !== 'number' || (args[key] as number) >= price) {
        args[key] = Math.round((price * 0.7) * 100) / 100;
      }
    }
  }
}

function applyMinMax(args: Record<string, unknown>, propNames: Set<string>): void {
  const pairs = [
    ['min', 'max'],
    ['minValue', 'maxValue'],
    ['minPrice', 'maxPrice'],
    ['minAge', 'maxAge'],
    ['minDate', 'maxDate'],
    ['start', 'end'],
    ['startDate', 'endDate'],
  ];

  for (const [minKey, maxKey] of pairs) {
    if (!propNames.has(minKey) || !propNames.has(maxKey)) continue;
    const minVal = args[minKey];
    const maxVal = args[maxKey];
    if (typeof minVal === 'number' && typeof maxVal === 'number' && minVal >= maxVal) {
      args[maxKey] = minVal + 10;
    }
  }
}

function applyStateHandler(args: Record<string, unknown>, propNames: Set<string>): void {
  const stateHandlerPairs = [
    { state: 'isOpen', handlers: ['onClose', 'onDismiss', 'onToggle'] },
    { state: 'isExpanded', handlers: ['onCollapse', 'onToggle'] },
    { state: 'isVisible', handlers: ['onHide', 'onClose', 'onToggle'] },
    { state: 'isActive', handlers: ['onDeactivate', 'onToggle'] },
    { state: 'isSelected', handlers: ['onSelect', 'onDeselect', 'onChange'] },
    { state: 'isChecked', handlers: ['onChange', 'onToggle'] },
  ];

  for (const { state, handlers } of stateHandlerPairs) {
    if (!propNames.has(state)) continue;
    const hasHandler = handlers.some(h => propNames.has(h));
    if (hasHandler && args[state] !== undefined) {
      // Set state to true so the component renders in its active state
      args[state] = true;
    }
  }
}

function applyCountArray(args: Record<string, unknown>, propNames: Set<string>): void {
  const countArrayPairs = [
    { count: 'itemCount', arrays: ['items'] },
    { count: 'count', arrays: ['items', 'data', 'list', 'options'] },
    { count: 'length', arrays: ['items', 'data', 'list'] },
    { count: 'total', arrays: [] }, // total is too ambiguous — skip
  ];

  for (const { count, arrays } of countArrayPairs) {
    if (!propNames.has(count) || typeof args[count] !== 'number') continue;

    for (const arrayKey of arrays) {
      if (propNames.has(arrayKey) && Array.isArray(args[arrayKey])) {
        args[count] = (args[arrayKey] as unknown[]).length;
        break;
      }
    }
  }
}

function findProp(propNames: Set<string>, candidates: string[]): string | undefined {
  return candidates.find(c => propNames.has(c));
}
