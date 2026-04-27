import Link from "next/link";

import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  return (
    <div>
      <h1>Code Arena</h1>
      <p>Submit a JavaScript bot. Every 5 minutes the server runs 3 matches with 10 bots each. Climb the ladder.</p>
      {user ? (
        <p>Signed in as <b>{user.name ?? user.email}</b>. <Link href="/bots">Go to my bots →</Link></p>
      ) : (
        <p><Link href="/login">Sign in with Google</Link> to submit a bot.</p>
      )}
      <div style={{ marginTop: 32 }}>
        <h2>How it works</h2>
        <ol>
          <li>Clone a sample bot, or write one from scratch.</li>
          <li>Save — your bot is automatically enrolled in matchmaking.</li>
          <li>Watch live matches; rewatch any past match; export your bot&apos;s data.</li>
        </ol>
      </div>
    </div>
  );
}