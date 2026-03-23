import { describe, it, expect } from 'vitest';
import type { PropMeta } from '../src/parser/componentParser.js';
import type { ProjectContext } from '../src/mcp/contextScanner.js';
import { extractValuesFromDataFiles, mergeExtracted } from '../src/ai/dataExtractor.js';
import type { ExtractedUsageArgs } from '../src/ai/usageExtractor.js';

function makeProps(...names: Array<{ name: string; typeName: string }>): PropMeta[] {
  return names.map((n) => ({ ...n, required: true }));
}

function makeDataFiles(...files: Array<{ file: string; preview: string }>): ProjectContext['mockDataFiles'] {
  return files;
}

// ---------------------------------------------------------------------------
// Object literal extraction
// ---------------------------------------------------------------------------

describe('extractValuesFromDataFiles — object literals', () => {
  it('extracts string values from object properties', () => {
    const files = makeDataFiles({
      file: 'data.ts',
      preview: `export const customer = {
  name: "Sarah Johnson",
  email: "sarah@example.com",
};`,
    });
    const props = makeProps(
      { name: 'name', typeName: 'string' },
      { name: 'email', typeName: 'string' },
    );
    const result = extractValuesFromDataFiles(files, props);
    expect(result.name).toContain('Sarah Johnson');
    expect(result.email).toContain('sarah@example.com');
  });

  it('extracts number values from object properties', () => {
    const files = makeDataFiles({
      file: 'data.ts',
      preview: `export const stats = {
  totalRevenue: 128450,
  revenueChange: 12.5,
  totalOrders: 342,
};`,
    });
    const props = makeProps(
      { name: 'totalRevenue', typeName: 'number' },
      { name: 'revenueChange', typeName: 'number' },
      { name: 'totalOrders', typeName: 'number' },
    );
    const result = extractValuesFromDataFiles(files, props);
    expect(result.totalRevenue).toContain('128450');
    expect(result.revenueChange).toContain('12.5');
    expect(result.totalOrders).toContain('342');
  });

  it('extracts boolean values from object properties', () => {
    const files = makeDataFiles({
      file: 'data.ts',
      preview: `export const config = {
  isActive: true,
  disabled: false,
};`,
    });
    const props = makeProps(
      { name: 'isActive', typeName: 'boolean' },
      { name: 'disabled', typeName: 'boolean' },
    );
    const result = extractValuesFromDataFiles(files, props);
    expect(result.isActive).toContain('true');
    expect(result.disabled).toContain('false');
  });

  it('extracts multiple values for same key from arrays of objects', () => {
    const files = makeDataFiles({
      file: 'data.ts',
      preview: `export const customers = [
  { name: "Sarah Johnson", status: "active" },
  { name: "James Wilson", status: "inactive" },
  { name: "Emily Chen", status: "churned" },
];`,
    });
    const props = makeProps(
      { name: 'name', typeName: 'string' },
      { name: 'status', typeName: 'string' },
    );
    const result = extractValuesFromDataFiles(files, props);
    expect(result.name).toEqual(['Sarah Johnson', 'James Wilson', 'Emily Chen']);
    expect(result.status).toEqual(['active', 'inactive', 'churned']);
  });

  it('only extracts values for props in the PropMeta list', () => {
    const files = makeDataFiles({
      file: 'data.ts',
      preview: `{ name: "Sarah", unknownProp: "secret" }`,
    });
    const props = makeProps({ name: 'name', typeName: 'string' });
    const result = extractValuesFromDataFiles(files, props);
    expect(result.name).toContain('Sarah');
    expect(result['unknownProp']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Redux / Zustand patterns
// ---------------------------------------------------------------------------

describe('extractValuesFromDataFiles — state management', () => {
  it('extracts from Redux createSlice initialState', () => {
    const files = makeDataFiles({
      file: 'authSlice.ts',
      preview: `import { createSlice } from "@reduxjs/toolkit";

const authSlice = createSlice({
  name: "auth",
  initialState: {
    username: "admin",
    role: "manager",
    isAuthenticated: false,
  },
  reducers: {},
});`,
    });
    const props = makeProps(
      { name: 'username', typeName: 'string' },
      { name: 'role', typeName: 'string' },
      { name: 'isAuthenticated', typeName: 'boolean' },
    );
    const result = extractValuesFromDataFiles(files, props);
    expect(result.username).toContain('admin');
    expect(result.role).toContain('manager');
    expect(result.isAuthenticated).toContain('false');
  });

  it('extracts from Zustand store', () => {
    const files = makeDataFiles({
      file: 'useStore.ts',
      preview: `import { create } from "zustand";

export const useStore = create((set) => ({
  title: "My Dashboard",
  count: 42,
  isLoading: false,
}));`,
    });
    const props = makeProps(
      { name: 'title', typeName: 'string' },
      { name: 'count', typeName: 'number' },
      { name: 'isLoading', typeName: 'boolean' },
    );
    const result = extractValuesFromDataFiles(files, props);
    expect(result.title).toContain('My Dashboard');
    expect(result.count).toContain('42');
    expect(result.isLoading).toContain('false');
  });
});

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

describe('extractValuesFromDataFiles — constants', () => {
  it('extracts from exported string constants', () => {
    const files = makeDataFiles({
      file: 'constants.ts',
      preview: `export const title = "Dashboard Overview";
export const subtitle = "Real-time metrics";`,
    });
    const props = makeProps(
      { name: 'title', typeName: 'string' },
      { name: 'subtitle', typeName: 'string' },
    );
    const result = extractValuesFromDataFiles(files, props);
    expect(result.title).toContain('Dashboard Overview');
    expect(result.subtitle).toContain('Real-time metrics');
  });

  it('extracts from exported number constants', () => {
    const files = makeDataFiles({
      file: 'constants.ts',
      preview: `export const maxItems = 100;
export const defaultPrice = 9.99;`,
    });
    const props = makeProps(
      { name: 'maxItems', typeName: 'number' },
      { name: 'defaultPrice', typeName: 'number' },
    );
    const result = extractValuesFromDataFiles(files, props);
    expect(result.maxItems).toContain('100');
    expect(result.defaultPrice).toContain('9.99');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('extractValuesFromDataFiles — edge cases', () => {
  it('returns empty object for empty files list', () => {
    const props = makeProps({ name: 'title', typeName: 'string' });
    expect(extractValuesFromDataFiles([], props)).toEqual({});
  });

  it('deduplicates identical values', () => {
    const files = makeDataFiles(
      { file: 'a.ts', preview: `{ name: "Alice" }` },
      { file: 'b.ts', preview: `{ name: "Alice" }` },
    );
    const props = makeProps({ name: 'name', typeName: 'string' });
    const result = extractValuesFromDataFiles(files, props);
    expect(result.name).toEqual(['Alice']);
  });

  it('handles negative numbers', () => {
    const files = makeDataFiles({
      file: 'data.ts',
      preview: `{ change: -2.5 }`,
    });
    const props = makeProps({ name: 'change', typeName: 'number' });
    const result = extractValuesFromDataFiles(files, props);
    expect(result.change).toContain('-2.5');
  });

  it('handles single-quoted strings', () => {
    const files = makeDataFiles({
      file: 'data.ts',
      preview: `{ title: 'Hello World' }`,
    });
    const props = makeProps({ name: 'title', typeName: 'string' });
    const result = extractValuesFromDataFiles(files, props);
    expect(result.title).toContain('Hello World');
  });

  it('extracts from multiple data files', () => {
    const files = makeDataFiles(
      { file: 'users.ts', preview: `{ name: "Alice", email: "alice@test.com" }` },
      { file: 'products.ts', preview: `{ name: "Widget", price: 29.99 }` },
    );
    const props = makeProps(
      { name: 'name', typeName: 'string' },
      { name: 'email', typeName: 'string' },
      { name: 'price', typeName: 'number' },
    );
    const result = extractValuesFromDataFiles(files, props);
    expect(result.name).toEqual(['Alice', 'Widget']);
    expect(result.email).toContain('alice@test.com');
    expect(result.price).toContain('29.99');
  });
});

// ---------------------------------------------------------------------------
// mergeExtracted
// ---------------------------------------------------------------------------

describe('mergeExtracted', () => {
  it('primary values come first', () => {
    const primary: ExtractedUsageArgs = { title: ['From JSX'] };
    const secondary: ExtractedUsageArgs = { title: ['From Data'] };
    const result = mergeExtracted(primary, secondary);
    expect(result.title[0]).toBe('From JSX');
    expect(result.title[1]).toBe('From Data');
  });

  it('includes keys only in secondary', () => {
    const primary: ExtractedUsageArgs = { title: ['Hello'] };
    const secondary: ExtractedUsageArgs = { name: ['World'] };
    const result = mergeExtracted(primary, secondary);
    expect(result.title).toEqual(['Hello']);
    expect(result.name).toEqual(['World']);
  });

  it('deduplicates across sources', () => {
    const primary: ExtractedUsageArgs = { title: ['Same'] };
    const secondary: ExtractedUsageArgs = { title: ['Same'] };
    const result = mergeExtracted(primary, secondary);
    expect(result.title).toEqual(['Same']);
  });

  it('handles empty primary', () => {
    const result = mergeExtracted({}, { title: ['Hello'] });
    expect(result.title).toEqual(['Hello']);
  });

  it('handles empty secondary', () => {
    const result = mergeExtracted({ title: ['Hello'] }, {});
    expect(result.title).toEqual(['Hello']);
  });

  it('handles both empty', () => {
    expect(mergeExtracted({}, {})).toEqual({});
  });
});
