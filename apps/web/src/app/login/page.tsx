"use client";
import { authClient } from "@/lib/auth-client";

async function signInWithGoogle() {
  await authClient.signIn.social({ provider: "google", callbackURL: "/bots" });
}

export default function LoginPage() {
  return (
    <div>
      <h1>Sign in</h1>
      <p>Sign in with your Google account to submit and manage bots.</p>
      <button className="primary" onClick={signInWithGoogle}>Continue with Google</button>
    </div>
  );
}
