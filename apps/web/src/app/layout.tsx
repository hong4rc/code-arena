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
          <a href="/" style={{ fontWeight: 600 }}>Code Arena</a>
          <a href="/bots">My bots</a>
          <a href="/samples">Samples</a>
          <a href="/matches">Matches</a>
          <a href="/leaderboard">Leaderboard</a>
          <span style={{ flex: 1 }} />
          <a href="/auth/login">Sign in</a>
        </header>
        <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>{children}</main>
      </body>
    </html>
  );
}
