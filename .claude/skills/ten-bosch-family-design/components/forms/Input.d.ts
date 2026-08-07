import * as React from 'react';

export interface InputProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  helpText?: string;
  error?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}
