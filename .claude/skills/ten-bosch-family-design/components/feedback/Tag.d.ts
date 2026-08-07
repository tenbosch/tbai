import * as React from 'react';

export interface TagProps {
  children?: React.ReactNode;
  onRemove?: () => void;
  color?: string;
}
