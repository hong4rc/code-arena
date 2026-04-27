import Link from "next/link";

import type { ReactNode } from "react";
// @ts-expect-error - CSS side-effect import handled by Next.js
import "./globals.css";

export const metadata = {
  title: "Code Arena",
  description: "Submit JS bots, watch them battle.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header style={{ padding: "12px 24px", borderBottom: "1px solid #ddd", display: "flex", gap: 16 }}>
          <Link href="/" style={{ fontWeight: 600 }}>Code Arena</Link>
          <Link href="/bots">My bots</Link>
          <Link href="/samples">Samples</Link>
          <Link href="/matches">Matches</Link>
          <Link href="/leaderboard">Leaderboard</Link>
          <span style={{ flex: 1 }} />
          <Link href="/login">Sign in</Link>
        </header>
        <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>{children}</main>
      </body>
    </html>
  );
}
