"use client";

import { DateTime } from "luxon";
import { useEffect, useState } from "react";

/**
 * Shows a relative timestamp like "3 min ago" / "in 2 hours".
 *
 * On hover, the title attribute shows the full ISO timestamp.
 * Auto-refreshes every 30 s so "just now" doesn't go stale.
 *
 *   <RelativeTime date={match.createdAt} />
 *
 * Accepts ISO strings (server props) or Date objects (client state).
 */
export function RelativeTime({ date, className }: { date: string | Date | number; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  let dt: DateTime;
  if (typeof date === "string") dt = DateTime.fromISO(date);
  else if (date instanceof Date) dt = DateTime.fromJSDate(date);
  else dt = DateTime.fromMillis(date);

  if (!dt.isValid) return <span className={className}>—</span>;

  return (
    <time dateTime={dt.toISO() ?? ""} title={dt.toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS)} className={className}>
      {dt.toRelative({ style: "short" }) ?? dt.toLocaleString(DateTime.DATETIME_SHORT)}
    </time>
  );
}
