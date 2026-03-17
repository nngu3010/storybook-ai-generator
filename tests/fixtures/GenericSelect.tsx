import React from 'react';

export default function Select<T extends { id: string; label: string }>(props: {
  options: T[];
  value?: T;
  onChange: (item: T) => void;
  placeholder?: string;
}) {
  const { options, value, onChange, placeholder = 'Select an option...' } = props;

  const containerStyles: React.CSSProperties = {
    position: 'relative',
    display: 'inline-block',
    minWidth: '200px',
  };

  const selectStyles: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    appearance: 'none',
  };

  return (
    <div style={containerStyles}>
      <select
        style={selectStyles}
        value={value?.id ?? ''}
        onChange={(e) => {
          const selected = options.find((o) => o.id === e.target.value);
          if (selected) onChange(selected);
        }}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
