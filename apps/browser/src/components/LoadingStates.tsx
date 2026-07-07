import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function PageSkeleton({ label }: { label: string }) {
  return (
    <section className="page-skeleton" aria-busy="true" aria-label={label} role="status">
      <div className="skeleton-title" />
      <div className="skeleton-grid">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
      <div className="skeleton-panels">
        <div className="skeleton-panel" />
        <div className="skeleton-panel" />
      </div>
    </section>
  );
}

type PendingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  pending: boolean;
};

export function PendingButton({ children, className, disabled, pending, type = 'button', ...props }: PendingButtonProps) {
  const classes = ['text-button', pending ? 'pending-button' : '', className].filter(Boolean).join(' ');

  return (
    <button {...props} aria-busy={pending ? 'true' : undefined} className={classes} disabled={disabled || pending} type={type}>
      {children}
    </button>
  );
}
