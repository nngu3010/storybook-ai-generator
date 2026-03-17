import React from 'react';

export interface CardProps {
  /** Card heading */
  title: string;
  /** Optional subtitle shown below the title */
  subtitle?: string;
  /** Content rendered inside the card body */
  children: React.ReactNode;
  /** Additional CSS class names */
  className?: string;
  /** Inline styles applied to the card wrapper */
  style?: React.CSSProperties;
}

export default function Card({ title, subtitle, children, className, style }: CardProps) {
  const cardStyles: React.CSSProperties = {
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '16px',
    backgroundColor: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    ...style,
  };

  const titleStyles: React.CSSProperties = {
    margin: '0 0 4px 0',
    fontSize: '18px',
    fontWeight: 600,
    color: '#111827',
  };

  const subtitleStyles: React.CSSProperties = {
    margin: '0 0 12px 0',
    fontSize: '14px',
    color: '#6b7280',
  };

  return (
    <div style={cardStyles} className={className}>
      <h2 style={titleStyles}>{title}</h2>
      {subtitle && <p style={subtitleStyles}>{subtitle}</p>}
      <div>{children}</div>
    </div>
  );
}
