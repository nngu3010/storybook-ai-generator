import React from 'react';
// Note: react-router-dom is not installed in this project — this fixture
// demonstrates a component with external deps and tests that the heuristic
// still identifies it as a component.
// In a real project you would have: import { useNavigate, Link } from 'react-router-dom';

export interface WithRouterProps {
  /** Target route path */
  to: string;
  /** Link label text */
  label: string;
}

// Minimal shim so the fixture compiles without react-router-dom installed
function useNavigate() {
  return (path: string) => { console.log('navigate to', path); };
}

function Link({ to, children }: { to: string; children: React.ReactNode }) {
  return <a href={to}>{children}</a>;
}

export default function WithRouter({ to, label }: WithRouterProps) {
  const navigate = useNavigate();

  return (
    <div>
      <Link to={to}>{label}</Link>
      <button type="button" onClick={() => navigate(to)}>
        Go to {label}
      </button>
    </div>
  );
}
