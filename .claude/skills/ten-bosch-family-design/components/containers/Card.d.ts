import * as React from 'react';

export interface CardProps {
  children?: React.ReactNode;
  /** Applies the arched-window motif to the top corners — use on one hero card per screen at most */
  arch?: boolean;
  padding?: 'sm' | 'md' | 'lg';
}
