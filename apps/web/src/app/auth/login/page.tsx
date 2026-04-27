"use client";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function LoginPage() {
  async function signIn() {
    const supabase = supabaseBrowser();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }
  return (
    <div>
      <h1>Sign in</h1>
      <button className="primary" onClick={signIn}>Continue with Google</button>
    </div>
  );
}
