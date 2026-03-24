import { describe, it, expect } from 'vitest';
import { isComponent, componentConfidence } from '../src/detector/heuristics.js';
import { isAsyncServerComponent } from '../src/detector/heuristics.js';

// ---------------------------------------------------------------------------
// isAsyncServerComponent — direct unit tests
// ---------------------------------------------------------------------------
describe('isAsyncServerComponent', () => {
  it('detects export default async function', () => {
    const content = `
      export default async function ProductPage({ params }) {
        const data = await fetch('/api/product');
        return <div>{data.name}</div>;
      }
    `;
    expect(isAsyncServerComponent(content)).toBe(true);
  });

  it('detects export default async arrow', () => {
    const content = `
      export default async () => {
        const data = await fetch('/api');
        return <div />;
      };
    `;
    expect(isAsyncServerComponent(content)).toBe(true);
  });

  it('detects async const with export default', () => {
    const content = `
      const GoldPassHeader = async () => {
        const data = await getData();
        return <div>{data.title}</div>;
      };
      export default GoldPassHeader;
    `;
    expect(isAsyncServerComponent(content)).toBe(true);
  });

  it('does NOT flag "use client" files even if async', () => {
    const content = `
      'use client';
      export default async function Page() {
        return <div />;
      }
    `;
    expect(isAsyncServerComponent(content)).toBe(false);
  });

  it('does NOT flag "use client" with double quotes', () => {
    const content = `
      "use client";
      export default async function Page() {
        return <div />;
      }
    `;
    expect(isAsyncServerComponent(content)).toBe(false);
  });

  it('does NOT flag non-async default exports', () => {
    const content = `
      export default function Button({ label }) {
        return <button>{label}</button>;
      }
    `;
    expect(isAsyncServerComponent(content)).toBe(false);
  });

  it('does NOT flag async functions that are not default export', () => {
    const content = `
      async function fetchData() {
        return await fetch('/api');
      }
      export default function Page() {
        return <div />;
      }
    `;
    expect(isAsyncServerComponent(content)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration with isComponent / componentConfidence
// ---------------------------------------------------------------------------
describe('isComponent — async server components', () => {
  it('rejects async server component', () => {
    const content = `
      export default async function GoldPassContent() {
        const data = await fetch('/api/goldpass');
        const json = await data.json();
        return (
          <div>
            <h1>{json.title}</h1>
          </div>
        );
      }
    `;
    expect(isComponent('GoldPassContent.tsx', content)).toBe(false);
    expect(componentConfidence('GoldPassContent.tsx', content)).toBe(0);
  });

  it('accepts client component with use client even if async', () => {
    const content = `
      'use client';
      export default async function ClientPage() {
        return <div>Client</div>;
      }
    `;
    // Should still be valid — it has 'use client'
    expect(isComponent('ClientPage.tsx', content)).toBe(true);
  });

  it('accepts normal synchronous components', () => {
    const content = `
      export default function Button({ label }: { label: string }) {
        return <button>{label}</button>;
      }
    `;
    expect(isComponent('Button.tsx', content)).toBe(true);
  });
});
