import React from 'react';

export enum Status {
  Active = 'active',
  Inactive = 'inactive',
  Pending = 'pending',
}

export enum Priority {
  Low = 0,
  Medium = 1,
  High = 2,
}

export interface StatusBadgeProps {
  /** Current status */
  status: Status;
  /** Priority level */
  priority?: Priority;
  /** Display label */
  label: string;
  /** Extra metadata */
  metadata?: Record<string, string>;
}

export default function StatusBadge({ status, priority = Priority.Medium, label, metadata }: StatusBadgeProps) {
  return (
    <span data-status={status} data-priority={priority}>
      {label}
    </span>
  );
}
