import type { ReactNode } from 'react';

/** A page's title (the page's only h1) and optional actions on the right. */
export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}
