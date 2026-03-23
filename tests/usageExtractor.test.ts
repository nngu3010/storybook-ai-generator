import { describe, it, expect } from 'vitest';
import type { PropMeta } from '../src/parser/componentParser.js';
import type { ProjectContext } from '../src/mcp/contextScanner.js';
import { extractArgsFromUsages } from '../src/ai/usageExtractor.js';

function makeProps(...names: Array<{ name: string; typeName: string }>): PropMeta[] {
  return names.map((n) => ({ ...n, required: true }));
}

describe('extractArgsFromUsages', () => {
  it('extracts string prop values from JSX attributes', () => {
    const usages: ProjectContext['componentUsages'] = [
      { file: 'App.tsx', snippets: ['<StatsCard title="Total Revenue" />'] },
    ];
    const props = makeProps({ name: 'title', typeName: 'string' });
    const result = extractArgsFromUsages(usages, props);
    expect(result).toEqual({ title: ['Total Revenue'] });
  });

  it('extracts multiple values for the same prop', () => {
    const usages: ProjectContext['componentUsages'] = [
      {
        file: 'Dashboard.tsx',
        snippets: [
          '<StatsCard title="Total Revenue" />',
          '<StatsCard title="Active Users" />',
        ],
      },
    ];
    const props = makeProps({ name: 'title', typeName: 'string' });
    const result = extractArgsFromUsages(usages, props);
    expect(result).toEqual({ title: ['Total Revenue', 'Active Users'] });
  });

  it('deduplicates identical values', () => {
    const usages: ProjectContext['componentUsages'] = [
      { file: 'A.tsx', snippets: ['<Card title="Hello" />'] },
      { file: 'B.tsx', snippets: ['<Card title="Hello" />'] },
    ];
    const props = makeProps({ name: 'title', typeName: 'string' });
    const result = extractArgsFromUsages(usages, props);
    expect(result).toEqual({ title: ['Hello'] });
  });

  it('extracts number values from curly braces', () => {
    const usages: ProjectContext['componentUsages'] = [
      { file: 'App.tsx', snippets: ['<StatsCard value={42} />'] },
    ];
    const props = makeProps({ name: 'value', typeName: 'number' });
    const result = extractArgsFromUsages(usages, props);
    expect(result).toEqual({ value: ['42'] });
  });

  it('extracts boolean values from curly braces', () => {
    const usages: ProjectContext['componentUsages'] = [
      { file: 'App.tsx', snippets: ['<Button disabled={true} />'] },
    ];
    const props = makeProps({ name: 'disabled', typeName: 'boolean' });
    const result = extractArgsFromUsages(usages, props);
    expect(result).toEqual({ disabled: ['true'] });
  });

  it('extracts string values from curly braces', () => {
    const usages: ProjectContext['componentUsages'] = [
      { file: 'App.tsx', snippets: ['<Card title={"My Title"} />'] },
    ];
    const props = makeProps({ name: 'title', typeName: 'string' });
    const result = extractArgsFromUsages(usages, props);
    expect(result).toEqual({ title: ['My Title'] });
  });

  it('skips variable references in curly braces', () => {
    const usages: ProjectContext['componentUsages'] = [
      { file: 'App.tsx', snippets: ['<Card title={myVar} onClick={handleClick} />'] },
    ];
    const props = makeProps(
      { name: 'title', typeName: 'string' },
      { name: 'onClick', typeName: '() => void' },
    );
    const result = extractArgsFromUsages(usages, props);
    expect(result).toEqual({});
  });

  it('skips object/array expressions in curly braces', () => {
    const usages: ProjectContext['componentUsages'] = [
      { file: 'App.tsx', snippets: ['<List items={[1,2,3]} style={{color: "red"}} />'] },
    ];
    const props = makeProps(
      { name: 'items', typeName: 'number[]' },
      { name: 'style', typeName: 'React.CSSProperties' },
    );
    const result = extractArgsFromUsages(usages, props);
    expect(result).toEqual({});
  });

  it('only extracts values for props in the PropMeta list', () => {
    const usages: ProjectContext['componentUsages'] = [
      { file: 'App.tsx', snippets: ['<Card title="Hello" unknownProp="world" />'] },
    ];
    const props = makeProps({ name: 'title', typeName: 'string' });
    const result = extractArgsFromUsages(usages, props);
    expect(result).toEqual({ title: ['Hello'] });
    expect(result['unknownProp']).toBeUndefined();
  });

  it('returns empty object for empty usages', () => {
    const props = makeProps({ name: 'title', typeName: 'string' });
    expect(extractArgsFromUsages([], props)).toEqual({});
  });

  it('returns empty object for undefined-like usages', () => {
    const props = makeProps({ name: 'title', typeName: 'string' });
    expect(extractArgsFromUsages([], props)).toEqual({});
  });

  it('extracts from multiple files and snippets', () => {
    const usages: ProjectContext['componentUsages'] = [
      {
        file: 'PageA.tsx',
        snippets: ['<Badge label="New" />', '<Badge label="Featured" />'],
      },
      {
        file: 'PageB.tsx',
        snippets: ['<Badge label="Sale" variant="warning" />'],
      },
    ];
    const props = makeProps(
      { name: 'label', typeName: 'string' },
      { name: 'variant', typeName: 'string' },
    );
    const result = extractArgsFromUsages(usages, props);
    expect(result.label).toEqual(['New', 'Featured', 'Sale']);
    expect(result.variant).toEqual(['warning']);
  });

  it('handles single-quoted string attributes', () => {
    const usages: ProjectContext['componentUsages'] = [
      { file: 'App.tsx', snippets: ["<Card title='Hello World' />"] },
    ];
    const props = makeProps({ name: 'title', typeName: 'string' });
    const result = extractArgsFromUsages(usages, props);
    expect(result).toEqual({ title: ['Hello World'] });
  });

  it('extracts negative numbers', () => {
    const usages: ProjectContext['componentUsages'] = [
      { file: 'App.tsx', snippets: ['<Slider min={-10} max={100} />'] },
    ];
    const props = makeProps(
      { name: 'min', typeName: 'number' },
      { name: 'max', typeName: 'number' },
    );
    const result = extractArgsFromUsages(usages, props);
    expect(result).toEqual({ min: ['-10'], max: ['100'] });
  });

  it('extracts decimal numbers', () => {
    const usages: ProjectContext['componentUsages'] = [
      { file: 'App.tsx', snippets: ['<Product price={9.99} />'] },
    ];
    const props = makeProps({ name: 'price', typeName: 'number' });
    const result = extractArgsFromUsages(usages, props);
    expect(result).toEqual({ price: ['9.99'] });
  });
});

describe('extractArgsFromUsages integration with heuristicGenerator', () => {
  it('extracted values are preferred over heuristic defaults', async () => {
    // This is tested more directly in the heuristic generator tests,
    // but we verify the extractor output is in the right shape
    const usages: ProjectContext['componentUsages'] = [
      { file: 'Dashboard.tsx', snippets: ['<StatsCard title="Total Revenue" value={50000} trend="up" />'] },
    ];
    const props = makeProps(
      { name: 'title', typeName: 'string' },
      { name: 'value', typeName: 'number' },
      { name: 'trend', typeName: 'string' },
    );
    const result = extractArgsFromUsages(usages, props);
    expect(result.title).toContain('Total Revenue');
    expect(result.value).toContain('50000');
    expect(result.trend).toContain('up');
  });
});
