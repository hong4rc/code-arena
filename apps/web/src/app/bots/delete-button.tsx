"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function DeleteBotButton({ botId, botName }: { botId: string; botName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (!globalThis.confirm(`Delete bot "${botName}"? Past matches stay but this bot is gone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/bots/${botId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      globalThis.alert(`Delete failed: ${json.error ?? res.status}`);
      return;
    }
    start(() => router.refresh());
  }

  return (
    <button
      className="danger"
      onClick={onClick}
      disabled={busy || pending}
      style={{ minWidth: 88 }}
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
