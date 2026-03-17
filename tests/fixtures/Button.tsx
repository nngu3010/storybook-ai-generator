import React from 'react';

export interface ButtonProps {
  /** The text label displayed inside the button */
  label: string;
  /** Visual style variant */
  variant?: 'primary' | 'secondary' | 'danger';
  /** Size of the button */
  size?: 'sm' | 'md' | 'lg';
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Click handler */
  onClick?: () => void;
}

export default function Button({
  label,
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
}: ButtonProps) {
  const baseStyles: React.CSSProperties = {
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    padding: size === 'sm' ? '4px 8px' : size === 'lg' ? '12px 24px' : '8px 16px',
    backgroundColor:
      variant === 'primary' ? '#3b82f6' : variant === 'danger' ? '#ef4444' : '#6b7280',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: size === 'sm' ? '12px' : size === 'lg' ? '18px' : '14px',
  };

  return (
    <button style={baseStyles} disabled={disabled} onClick={onClick} type="button">
      {label}
    </button>
  );
}
