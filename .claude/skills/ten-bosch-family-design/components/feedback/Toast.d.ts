import * as React from 'react';

export interface ToastProps {
  tone?: 'success' | 'warning' | 'danger' | 'info';
  children?: React.ReactNode;
  onClose?: () => void;
}
