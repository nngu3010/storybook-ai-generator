/**
 * Utility functions for formatting and string manipulation.
 * This file has no JSX, no React imports, and no default export that
 * returns JSX — so it should be excluded by the heuristics.
 */

export function formatCurrency(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}

export function truncate(str: string, maxLength: number, ellipsis = '…'): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - ellipsis.length) + ellipsis;
}

export function capitalise(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export type Formatter<T> = (value: T) => string;

export const defaultFormatters: Record<string, Formatter<unknown>> = {
  string: (v) => String(v),
  number: (v) => String(v),
  boolean: (v) => (v ? 'Yes' : 'No'),
};
