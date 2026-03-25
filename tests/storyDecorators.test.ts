import { describe, it, expect } from 'vitest';
import { buildStoryContent } from '../src/generator/storyBuilder.js';
import type { ComponentMeta } from '../src/parser/componentParser.js';
import type { RequiredDecorator } from '../src/detector/providerScanner.js';
import type { DetectedProvider } from '../src/decorators/providerDetector.js';
import { providerToDecorator, mergeDecorators } from '../src/cli/commands/generate.js';

function makeMeta(overrides: Partial<ComponentMeta> = {}): ComponentMeta {
  return {
    name: 'CartButton',
    filePath: '/src/components/CartButton.tsx',
    props: [
      { name: 'label', typeName: 'string', required: true },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Decorator injection in story content
// ---------------------------------------------------------------------------
describe('buildStoryContent — decorator injection', () => {
  it('injects Redux decorator imports and decorators array', () => {
    const decorators: RequiredDecorator[] = [
      {
        label: 'Redux',
        imports: [
          "import { Provider as ReduxProvider } from 'react-redux';",
          "import { configureStore } from '@reduxjs/toolkit';",
        ],
        decorator: '<ReduxProvider store={configureStore({ reducer: {} })}>{children}</ReduxProvider>',
      },
    ];

    const content = buildStoryContent(makeMeta(), './CartButton', { decorators });

    expect(content).toContain("import { Provider as ReduxProvider } from 'react-redux';");
    expect(content).toContain("import { configureStore } from '@reduxjs/toolkit';");
    expect(content).toContain('decorators: [');
    expect(content).toContain('(Story) =>');
    expect(content).toContain('<ReduxProvider');
    expect(content).toContain('<Story />');
    expect(content).toContain('</ReduxProvider>');
  });

  it('injects multiple decorators in order', () => {
    const decorators: RequiredDecorator[] = [
      {
        label: 'Redux',
        imports: ["import { Provider as ReduxProvider } from 'react-redux';"],
        decorator: '<ReduxProvider store={{}}>{children}</ReduxProvider>',
      },
      {
        label: 'React Router',
        imports: ["import { MemoryRouter } from 'react-router-dom';"],
        decorator: '<MemoryRouter>{children}</MemoryRouter>',
      },
    ];

    const content = buildStoryContent(makeMeta(), './CartButton', { decorators });

    expect(content).toContain('ReduxProvider');
    expect(content).toContain('MemoryRouter');
    // Both decorators should be in the array
    const decoratorsMatch = content.match(/\(Story\)/g);
    expect(decoratorsMatch?.length).toBe(2);
  });

  it('generates valid story without decorators', () => {
    const content = buildStoryContent(makeMeta(), './CartButton', {});

    expect(content).not.toContain('decorators');
    expect(content).toContain('export const Default: Story');
  });

  it('does not add decorators array when empty', () => {
    const content = buildStoryContent(makeMeta(), './CartButton', { decorators: [] });
    expect(content).not.toContain('decorators');
  });
});

// ---------------------------------------------------------------------------
// providerToDecorator conversion
// ---------------------------------------------------------------------------
describe('providerToDecorator', () => {
  it('converts a DetectedProvider to RequiredDecorator', () => {
    const provider: DetectedProvider = {
      library: 'react-redux',
      label: 'Redux',
      importStatement: "import { Provider as ReduxProvider } from 'react-redux';\nimport { mockStore } from './mockStore';",
      wrapper: '<ReduxProvider store={mockStore}>{children}</ReduxProvider>',
    };

    const dec = providerToDecorator(provider);

    expect(dec.label).toBe('Redux');
    expect(dec.imports).toEqual([
      "import { Provider as ReduxProvider } from 'react-redux';",
      "import { mockStore } from './mockStore';",
    ]);
    expect(dec.decorator).toBe('<ReduxProvider store={mockStore}>{children}</ReduxProvider>');
  });

  it('handles empty importStatement', () => {
    const provider: DetectedProvider = {
      library: 'zustand',
      label: 'Zustand',
      importStatement: '',
      wrapper: '',
    };

    const dec = providerToDecorator(provider);
    expect(dec.imports).toEqual([]);
    expect(dec.decorator).toBe('');
  });
});

// ---------------------------------------------------------------------------
// mergeDecorators
// ---------------------------------------------------------------------------
describe('mergeDecorators', () => {
  const reduxGlobal: RequiredDecorator = {
    label: 'Redux',
    imports: ["import { Provider as ReduxProvider } from 'react-redux';"],
    decorator: '<ReduxProvider store={mockStore}>{children}</ReduxProvider>',
  };

  const reduxPerComponent: RequiredDecorator = {
    label: 'Redux',
    imports: [
      "import { Provider as ReduxProvider } from 'react-redux';",
      "import { configureStore } from '@reduxjs/toolkit';",
    ],
    decorator: '<ReduxProvider store={configureStore({ reducer: {} })}>{children}</ReduxProvider>',
  };

  const routerGlobal: RequiredDecorator = {
    label: 'React Router',
    imports: ["import { MemoryRouter } from 'react-router-dom';"],
    decorator: '<MemoryRouter>{children}</MemoryRouter>',
  };

  const queryPerComponent: RequiredDecorator = {
    label: 'React Query',
    imports: ["import { QueryClient, QueryClientProvider } from '@tanstack/react-query';"],
    decorator: '<QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>',
  };

  it('per-component decorators take precedence over global', () => {
    const merged = mergeDecorators([reduxGlobal, routerGlobal], [reduxPerComponent]);

    expect(merged).toHaveLength(2);
    // Redux should come from per-component (has configureStore import)
    expect(merged[0].label).toBe('Redux');
    expect(merged[0].imports).toContain("import { configureStore } from '@reduxjs/toolkit';");
    // Router from global
    expect(merged[1].label).toBe('React Router');
  });

  it('combines non-overlapping decorators from both sources', () => {
    const merged = mergeDecorators([routerGlobal], [queryPerComponent]);

    expect(merged).toHaveLength(2);
    expect(merged.map((d) => d.label)).toEqual(['React Query', 'React Router']);
  });

  it('returns empty array when both sources are empty', () => {
    expect(mergeDecorators([], [])).toEqual([]);
  });

  it('returns only global when no per-component decorators', () => {
    const merged = mergeDecorators([reduxGlobal, routerGlobal], []);
    expect(merged).toHaveLength(2);
  });

  it('returns only per-component when no global decorators', () => {
    const merged = mergeDecorators([], [queryPerComponent]);
    expect(merged).toHaveLength(1);
    expect(merged[0].label).toBe('React Query');
  });
});
