"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { authClient } from "@/lib/auth-client";

async function signInWithGoogle() {
  await authClient.signIn.social({ provider: "google", callbackURL: "/bots" });
}

const REASONS: Record<string, string> = {
  "clone-needs-auth": "You need to be signed in to clone a bot.",
  "session-expired": "Your session expired. Please sign in again.",
};

function LoginCard() {
  const params = useSearchParams();
  const reason = params.get("reason");
  const message = reason && REASONS[reason] ? REASONS[reason] : null;

  return (
    <div style={{ maxWidth: 420, margin: "60px auto", textAlign: "center" }}>
      <div className="card" style={{ padding: "32px 28px" }}>
        <h1 style={{ marginBottom: 6 }}>Sign in</h1>
        {message ? (
          <p style={{ color: "var(--peach)", marginBottom: 20 }}>{message}</p>
        ) : (
          <p style={{ marginBottom: 24 }}>Use your Google account to submit and manage bots.</p>
        )}
        <button className="primary" onClick={signInWithGoogle} style={{ width: "100%", justifyContent: "center", padding: "10px 16px" }}>
          Continue with Google
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginCard />
    </Suspense>
  );
}
