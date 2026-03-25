import { describe, it, expect } from 'vitest';
import { needsTsxExtension } from '../src/generator/storyBuilder.js';
import { computeStoryPath } from '../src/generator/storyWriter.js';

describe('needsTsxExtension', () => {
  it('returns true for content with JSX decorator wrapper', () => {
    const content = `
      decorators: [
        (Story) => <ThemeProvider><Story /></ThemeProvider>
      ],
    `;
    expect(needsTsxExtension(content)).toBe(true);
  });

  it('returns true for content with self-closing JSX', () => {
    const content = 'args: { icon: <Icon /> }';
    expect(needsTsxExtension(content)).toBe(true);
  });

  it('returns false for plain TypeScript story', () => {
    const content = `
      import { Meta, StoryObj } from '@storybook/react';
      const meta: Meta<typeof Button> = { component: Button };
      export default meta;
      export const Default: Story = { args: { label: "Click me" } };
    `;
    expect(needsTsxExtension(content)).toBe(false);
  });

  it('returns false for content with only string angle brackets', () => {
    const content = `args: { label: "Price < $10", note: "a > b" }`;
    expect(needsTsxExtension(content)).toBe(false);
  });
});

describe('computeStoryPath with tsx', () => {
  it('uses .stories.tsx when tsx=true', () => {
    const result = computeStoryPath('/src/Button.tsx', '/src', undefined, true);
    expect(result).toContain('.stories.tsx');
    expect(result).not.toContain('.stories.ts.stories');
  });

  it('uses .stories.ts by default', () => {
    const result = computeStoryPath('/src/Button.tsx', '/src');
    expect(result).toContain('.stories.ts');
    expect(result).not.toContain('.stories.tsx');
  });

  it('uses .stories.tsx with outputDir', () => {
    const result = computeStoryPath('/src/components/Button.tsx', '/src', '/out', true);
    expect(result).toContain('.stories.tsx');
  });
});
