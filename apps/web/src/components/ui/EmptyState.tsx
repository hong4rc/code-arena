import Link from "next/link";

import type { ReactNode } from "react";

/**
 * Standard empty-state card. Shows when a list page has no rows.
 *
 *   <EmptyState
 *     icon="🤖"
 *     title="No bots yet"
 *     body="Clone a sample bot to get started, or write one from scratch."
 *     cta={{ href: "/samples", label: "Browse samples" }}
 *   />
 */
export function EmptyState({
  icon,
  title,
  body,
  cta,
  children,
}: {
  icon?: string;
  title: string;
  body?: string;
  cta?: { href: string; label: string } | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <h3 className="empty-state-title">{title}</h3>
      {body && <p className="empty-state-body">{body}</p>}
      {children}
      {cta && (
        <Link href={cta.href} className="btn primary" style={{ marginTop: 12 }}>
          {cta.label}
        </Link>
      )}
    </div>
  );
}
