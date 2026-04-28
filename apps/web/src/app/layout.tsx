import Link from "next/link";


import { SignOutButton } from "@/components/SignOutButton";
import { getCurrentUser } from "@/lib/auth";

import type { ReactNode } from "react";

// @ts-expect-error - CSS side-effect import handled by Next.js
import "./globals.css";

export const metadata = {
  title: "Code Arena",
  description: "Submit JS bots, watch them battle.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <header className="app-header">
          <Link href="/" className="brand">⚔ Code Arena</Link>
          <Link href="/bots">My bots</Link>
          <Link href="/samples">Samples</Link>
          <Link href="/matches">Matches</Link>
          <Link href="/leaderboard">Leaderboard</Link>
          {user?.role === "admin" && (
            <span className="admin-nav">
              <Link href="/admin">Admin</Link>
            </span>
          )}
          <span className="spacer" />
          {user ? (
            <>
              {user.role === "admin" && (
                <span className="user-pill" style={{ background: "rgba(231, 130, 132, 0.15)", color: "var(--red, #e78284)", borderColor: "var(--red, #e78284)" }}>
                  admin
                </span>
              )}
              <span className="user-pill">
                <span style={{ color: "var(--green)" }}>●</span>
                {user.name ?? user.email}
              </span>
              <SignOutButton />
            </>
          ) : (
            <Link href="/login" className="btn primary">Sign in</Link>
          )}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
