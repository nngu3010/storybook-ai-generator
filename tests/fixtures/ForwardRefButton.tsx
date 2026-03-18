import React from 'react';

export interface ForwardRefButtonProps {
  /** Button label */
  label: string;
  /** Visual variant */
  variant?: 'primary' | 'secondary' | 'danger';
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Click handler */
  onClick?: () => void;
}

const ForwardRefButton = React.forwardRef<HTMLButtonElement, ForwardRefButtonProps>(
  ({ label, variant = 'primary', disabled = false, onClick }, ref) => (
    <button ref={ref} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  )
);

ForwardRefButton.displayName = 'ForwardRefButton';

export default ForwardRefButton;
