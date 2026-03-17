import React from 'react';

export interface InputProps {
  /** Current value of the input */
  value: string;
  /** Placeholder text shown when input is empty */
  placeholder?: string;
  /** Called with the new value whenever the input changes */
  onChange: (value: string) => void;
  /** HTML input type */
  type?: 'text' | 'email' | 'password';
  /** Validation error message to display below the input */
  error?: string;
}

export default function Input({
  value,
  placeholder,
  onChange,
  type = 'text',
  error,
}: InputProps) {
  const inputStyles: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    fontSize: '14px',
    border: error ? '1px solid #ef4444' : '1px solid #d1d5db',
    borderRadius: '4px',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const errorStyles: React.CSSProperties = {
    marginTop: '4px',
    fontSize: '12px',
    color: '#ef4444',
  };

  return (
    <div>
      <input
        style={inputStyles}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <p style={errorStyles}>{error}</p>}
    </div>
  );
}
