import React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Small shared primitives for Curriculum Tracker / Test Attempts / Quizzes &
// Exams — cva just picks a `data-tone`/`data-size` attribute (type-safe,
// autocompletable variants); the actual light/dark colors live in
// lms.css's `:root[data-theme='dark']` rules, same pattern as the rest of
// this module, so nothing here fights the app's existing theme system.

const pillVariants = cva('lms-pill', {
  variants: {
    tone: {
      success: '',
      danger: '',
      warning: '',
      info: '',
      neutral: '',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function StatusPill({ tone = 'neutral', className, children }) {
  return (
    <span className={cn(pillVariants({ tone }), className)} data-tone={tone}>
      {children}
    </span>
  );
}

const headingVariants = cva('lms-heading', {
  variants: {
    size: { md: '', lg: '' },
  },
  defaultVariants: { size: 'lg' },
});

export function PageHeading({ icon, title, description, actions, size = 'lg', className }) {
  return (
    <div className={cn('lms-portal-head', className)}>
      <div className={cn(headingVariants({ size }))}>
        <h2>{icon} {title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions ? <div className="lms-portal-actions">{actions}</div> : null}
    </div>
  );
}

// Consistent AntD Table pagination across all three pages — page-size
// switcher, a human "x–y of n" total, and sensible size steps.
export function tablePagination(overrides = {}) {
  return {
    showSizeChanger: true,
    pageSizeOptions: [10, 25, 50, 100],
    showTotal: (total, range) => `${range[0]}–${range[1]} of ${total}`,
    ...overrides,
  };
}
