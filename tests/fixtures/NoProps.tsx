import React from 'react';

export default function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Logo"
      >
        <rect width="32" height="32" rx="8" fill="#3b82f6" />
        <text x="8" y="22" fontSize="16" fill="white" fontWeight="bold">
          SG
        </text>
      </svg>
      <span style={{ fontSize: '16px', fontWeight: 600, color: '#111827' }}>storybook-gen</span>
    </div>
  );
}
