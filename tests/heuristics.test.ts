import { describe, it, expect } from 'vitest';
import { isComponent, componentConfidence } from '../src/detector/heuristics.js';

// ---------------------------------------------------------------------------
// Valid components — should return true
// ---------------------------------------------------------------------------
describe('isComponent — valid components', () => {
  it('detects a simple function component with JSX', () => {
    const content = `
      import React from 'react';
      export default function Button({ label }: { label: string }) {
        return <button>{label}</button>;
      }
    `;
    expect(isComponent('Button.tsx', content)).toBe(true);
  });

  it('detects an arrow function component', () => {
    const content = `
      import React from 'react';
      const Card = ({ title }: { title: string }) => (
        <div>{title}</div>
      );
      export default Card;
    `;
    expect(isComponent('Card.tsx', content)).toBe(true);
  });

  it('detects a component with multiline JSX return', () => {
    const content = `
      import React from 'react';
      export default function Modal({ children }: { children: React.ReactNode }) {
        return (
          <div className="modal">
            <div className="modal-body">{children}</div>
          </div>
        );
      }
    `;
    expect(isComponent('Modal.tsx', content)).toBe(true);
  });

  it('detects a component even when file has a capital name', () => {
    const content = `
      import React from 'react';
      export default function Avatar() {
        return <img src="/avatar.png" alt="user" />;
      }
    `;
    expect(isComponent('Avatar.tsx', content)).toBe(true);
  });

  it('assigns confidence >= 0.5 for a well-formed component', () => {
    const content = `
      import React from 'react';
      export default function Input({ value }: { value: string }) {
        return <input value={value} onChange={() => {}} />;
      }
    `;
    expect(componentConfidence('Input.tsx', content)).toBeGreaterThanOrEqual(0.5);
  });
});

// ---------------------------------------------------------------------------
// Utility files — should return false
// ---------------------------------------------------------------------------
describe('isComponent — utility / non-component files', () => {
  it('rejects a plain TypeScript utility file (.ts not .tsx)', () => {
    const content = `
      export function formatDate(d: Date): string {
        return d.toISOString();
      }
    `;
    expect(isComponent('utils.ts', content)).toBe(false);
  });

  it('rejects a file with no JSX at all', () => {
    const content = `
      export function add(a: number, b: number) {
        return a + b;
      }
      export default add;
    `;
    // .tsx without JSX — low confidence
    expect(isComponent('math.tsx', content)).toBe(false);
  });

  it('rejects a file with only type definitions', () => {
    const content = `
      export interface Theme {
        primary: string;
        secondary: string;
      }
      export type Size = 'sm' | 'md' | 'lg';
    `;
    expect(isComponent('types.ts', content)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test and spec files — always excluded
// ---------------------------------------------------------------------------
describe('isComponent — test and spec files', () => {
  it('rejects .test.tsx files', () => {
    const content = `
      import { render } from '@testing-library/react';
      import Button from './Button';
      test('renders button', () => {
        render(<Button label="click" />);
      });
    `;
    expect(isComponent('Button.test.tsx', content)).toBe(false);
  });

  it('rejects .spec.tsx files', () => {
    const content = `
      describe('Input', () => {
        it('renders', () => {
          expect(true).toBe(true);
        });
      });
    `;
    expect(isComponent('Input.spec.tsx', content)).toBe(false);
  });

  it('rejects test files regardless of content', () => {
    const content = `
      export default function NotReallyAComponent() {
        return <div>test</div>;
      }
    `;
    expect(isComponent('Component.test.tsx', content)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Story files — always excluded
// ---------------------------------------------------------------------------
describe('isComponent — story files', () => {
  it('rejects .stories.tsx files', () => {
    const content = `
      import Button from './Button';
      export default { title: 'Button', component: Button };
      export const Default = {};
    `;
    expect(isComponent('Button.stories.tsx', content)).toBe(false);
  });

  it('rejects .stories.ts files', () => {
    const content = `export default {};`;
    expect(isComponent('Card.stories.ts', content)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Barrel / index files — should be excluded
// ---------------------------------------------------------------------------
describe('isComponent — barrel/index files', () => {
  it('rejects a barrel file with only re-exports', () => {
    const content = `
      export { default as Button } from './Button.js';
      export { default as Input } from './Input.js';
    `;
    expect(isComponent('index.tsx', content)).toBe(false);
  });

  it('rejects a barrel with export * syntax', () => {
    const content = `
      export * from './Button.js';
      export * from './Input.js';
    `;
    expect(isComponent('index.tsx', content)).toBe(false);
  });

  it('rejects an index.ts barrel file', () => {
    const content = `
      export { default as Button } from './Button.js';
      export type { ButtonProps } from './Button.js';
    `;
    expect(isComponent('index.ts', content)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HOC pattern — reduced confidence / excluded
// ---------------------------------------------------------------------------
describe('isComponent — HOC detection', () => {
  it('gives lower confidence to HOC returning a function', () => {
    const content = `
      import React from 'react';
      export default function withAuth(Component: React.ComponentType) {
        return function AuthenticatedComponent(props: object) {
          return <Component {...props} />;
        };
      }
    `;
    // HOC may still pass or fail — we just check that confidence is reduced
    const conf = componentConfidence('withAuth.tsx', content);
    // HOC penalty reduces score
    expect(conf).toBeLessThan(0.9);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('isComponent — edge cases', () => {
  it('handles empty file', () => {
    expect(isComponent('Empty.tsx', '')).toBe(false);
  });

  it('handles file with only comments', () => {
    const content = `
      // This file is intentionally empty
      /* placeholder */
    `;
    expect(isComponent('Placeholder.tsx', content)).toBe(false);
  });

  it('confidence is in range 0-1', () => {
    const content = `
      import React from 'react';
      export default function Foo() { return <div>foo</div>; }
    `;
    const conf = componentConfidence('Foo.tsx', content);
    expect(conf).toBeGreaterThanOrEqual(0);
    expect(conf).toBeLessThanOrEqual(1);
  });
});
