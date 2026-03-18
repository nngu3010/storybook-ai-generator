import React from 'react';

export interface MemoForwardRefProps {
  /** Input label */
  label: string;
  /** Input placeholder */
  placeholder?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
}

export default React.memo(
  React.forwardRef<HTMLInputElement, MemoForwardRefProps>(
    ({ label, placeholder, disabled = false }, ref) => (
      <div>
        <label>{label}</label>
        <input ref={ref} placeholder={placeholder} disabled={disabled} />
      </div>
    )
  )
);
