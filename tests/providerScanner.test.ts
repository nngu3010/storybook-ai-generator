import { describe, it, expect } from 'vitest';
import { scanRequiredDecorators } from '../src/detector/providerScanner.js';

// ---------------------------------------------------------------------------
// Redux detection
// ---------------------------------------------------------------------------
describe('scanRequiredDecorators — Redux', () => {
  it('detects useSelector', () => {
    const content = `
      import { useSelector } from 'react-redux';
      export default function CartCount() {
        const count = useSelector((s) => s.cart.count);
        return <span>{count}</span>;
      }
    `;
    const result = scanRequiredDecorators('/fake/CartCount.tsx', content);
    expect(result.some((d) => d.label === 'Redux')).toBe(true);
  });

  it('detects useDispatch', () => {
    const content = `
      import { useDispatch } from 'react-redux';
      export default function AddButton() {
        const dispatch = useDispatch();
        return <button onClick={() => dispatch({ type: 'ADD' })}>Add</button>;
      }
    `;
    const result = scanRequiredDecorators('/fake/AddButton.tsx', content);
    expect(result.some((d) => d.label === 'Redux')).toBe(true);
  });

  it('Redux decorator includes Provider import', () => {
    const content = `
      import { useSelector } from 'react-redux';
      export default function Foo() { return <div />; }
    `;
    const result = scanRequiredDecorators('/fake/Foo.tsx', content);
    const redux = result.find((d) => d.label === 'Redux')!;
    expect(redux.imports.some((i) => i.includes('ReduxProvider'))).toBe(true);
    expect(redux.decorator).toContain('ReduxProvider');
    expect(redux.decorator).toContain('{children}');
  });
});

// ---------------------------------------------------------------------------
// Next.js Router detection
// ---------------------------------------------------------------------------
describe('scanRequiredDecorators — Next.js Router', () => {
  it('detects next/navigation import', () => {
    const content = `
      import { useRouter } from 'next/navigation';
      export default function Nav() {
        const router = useRouter();
        return <button onClick={() => router.push('/')}>Home</button>;
      }
    `;
    const result = scanRequiredDecorators('/fake/Nav.tsx', content);
    expect(result.some((d) => d.label === 'Next.js Router')).toBe(true);
  });

  it('detects useRouter() call without import check', () => {
    const content = `
      'use client';
      export default function Page() {
        const router = useRouter();
        return <div />;
      }
    `;
    const result = scanRequiredDecorators('/fake/Page.tsx', content);
    expect(result.some((d) => d.label === 'Next.js Router')).toBe(true);
  });

  it('Next.js Router decorator includes AppRouterContext', () => {
    const content = `
      import { useRouter } from 'next/navigation';
      export default function Foo() { return <div />; }
    `;
    const result = scanRequiredDecorators('/fake/Foo.tsx', content);
    const router = result.find((d) => d.label === 'Next.js Router')!;
    expect(router.imports.some((i) => i.includes('AppRouterContext'))).toBe(true);
    expect(router.decorator).toContain('AppRouterContext.Provider');
  });
});

// ---------------------------------------------------------------------------
// React Query detection
// ---------------------------------------------------------------------------
describe('scanRequiredDecorators — React Query', () => {
  it('detects useQuery', () => {
    const content = `
      import { useQuery } from '@tanstack/react-query';
      export default function Feed() {
        const { data } = useQuery({ queryKey: ['feed'] });
        return <div>{data}</div>;
      }
    `;
    const result = scanRequiredDecorators('/fake/Feed.tsx', content);
    expect(result.some((d) => d.label === 'React Query')).toBe(true);
  });

  it('detects useMutation', () => {
    const content = `
      import { useMutation } from '@tanstack/react-query';
      export default function Form() {
        const mut = useMutation({ mutationFn: async () => {} });
        return <form />;
      }
    `;
    const result = scanRequiredDecorators('/fake/Form.tsx', content);
    expect(result.some((d) => d.label === 'React Query')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// React Router detection
// ---------------------------------------------------------------------------
describe('scanRequiredDecorators — React Router', () => {
  it('detects useNavigate from react-router-dom', () => {
    const content = `
      import { useNavigate } from 'react-router-dom';
      export default function BackBtn() {
        const navigate = useNavigate();
        return <button onClick={() => navigate(-1)}>Back</button>;
      }
    `;
    const result = scanRequiredDecorators('/fake/BackBtn.tsx', content);
    expect(result.some((d) => d.label === 'React Router')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Custom context providers
// ---------------------------------------------------------------------------
describe('scanRequiredDecorators — Custom Context Providers', () => {
  it('detects useModal from ModalProvider', () => {
    const content = `
      import { useModal } from '../providers/ModalProvider';
      export default function OpenBtn() {
        const { open } = useModal();
        return <button onClick={() => open()}>Open</button>;
      }
    `;
    const result = scanRequiredDecorators('/fake/OpenBtn.tsx', content);
    expect(result.some((d) => d.label === 'ModalProvider')).toBe(true);
  });

  it('detects useAuth from AuthContext', () => {
    const content = `
      import { useAuth } from '@/contexts/AuthContext';
      export default function Profile() {
        const { user } = useAuth();
        return <div>{user.name}</div>;
      }
    `;
    const result = scanRequiredDecorators('/fake/Profile.tsx', content);
    expect(result.some((d) => d.label === 'AuthContext')).toBe(true);
  });

  it('ignores non-hook imports from context files', () => {
    const content = `
      import { AuthContext, AUTH_KEY } from '../contexts/AuthContext';
      export default function Foo() { return <div />; }
    `;
    const result = scanRequiredDecorators('/fake/Foo.tsx', content);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// No providers needed
// ---------------------------------------------------------------------------
describe('scanRequiredDecorators — no providers', () => {
  it('returns empty array for a simple component', () => {
    const content = `
      export default function Button({ label }: { label: string }) {
        return <button>{label}</button>;
      }
    `;
    const result = scanRequiredDecorators('/fake/Button.tsx', content);
    expect(result).toHaveLength(0);
  });

  it('does not duplicate providers', () => {
    const content = `
      import { useSelector, useDispatch } from 'react-redux';
      export default function Foo() {
        const x = useSelector(s => s);
        const d = useDispatch();
        return <div />;
      }
    `;
    const result = scanRequiredDecorators('/fake/Foo.tsx', content);
    const reduxCount = result.filter((d) => d.label === 'Redux').length;
    expect(reduxCount).toBe(1);
  });
});
