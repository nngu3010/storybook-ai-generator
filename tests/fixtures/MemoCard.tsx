import React from 'react';

export interface MemoCardProps {
  /** Card title */
  title: string;
  /** Optional description */
  description?: string;
  /** Card size */
  size?: 'sm' | 'md' | 'lg';
}

function MemoCard({ title, description, size = 'md' }: MemoCardProps) {
  return (
    <div>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  );
}

export default React.memo(MemoCard);
