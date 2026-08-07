import * as React from 'react';

export interface ButtonProps {
  children?: React.ReactNode;
  /** Visual style of the button */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Optional leading icon element (e.g. a Lucide <i data-lucide="..."> or SVG) */
  icon?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
}
