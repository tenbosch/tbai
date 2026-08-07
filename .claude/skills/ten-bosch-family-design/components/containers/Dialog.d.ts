import * as React from 'react';

export interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title?: string;
  children?: React.ReactNode;
  /** Usually a row of Button elements */
  actions?: React.ReactNode;
}
