"use client";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  async function signIn() {
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/bots",
    });
  }
  return (
    <div>
      <h1>Sign in</h1>
      <p>Sign in with your Google account to submit and manage bots.</p>
      <button className="primary" onClick={signIn}>Continue with Google</button>
    </div>
  );
}
