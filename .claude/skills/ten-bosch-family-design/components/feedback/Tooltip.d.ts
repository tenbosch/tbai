import * as React from 'react';

export interface TooltipProps {
  children?: React.ReactNode;
  label?: string;
  side?: 'top' | 'bottom';
}
