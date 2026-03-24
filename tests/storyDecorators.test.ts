import { describe, it, expect } from 'vitest';
import { buildStoryContent } from '../src/generator/storyBuilder.js';
import type { ComponentMeta } from '../src/parser/componentParser.js';
import type { RequiredDecorator } from '../src/detector/providerScanner.js';

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
