"use client";
import { authClient } from "@/lib/auth-client";

async function signOut() {
  await authClient.signOut();
  window.location.href = "/";
}

export function SignOutButton() {
  return <button onClick={signOut} className="btn">Sign out</button>;
}
