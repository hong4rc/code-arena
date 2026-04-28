"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/ui/Toast";

interface BotRow { id: string; name: string; ownerId: string; isOfficial: boolean; isOwn: boolean }

const MIN_BOTS = 2;
const MAX_BOTS = 10;

export function CustomMatchPicker({ bots }: { bots: BotRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setError(null);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_BOTS) next.add(id);
      return next;
    });
  }

  async function start() {
    if (picked.size < MIN_BOTS) { setError(`Pick at least ${MIN_BOTS} bots.`); return; }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/matches/custom", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botIds: [...picked] }),
    });
    setBusy(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? `failed (${res.status})`);
      toast(`Match start failed: ${json.error ?? res.status}`, "error");
      return;
    }
    const json = await res.json() as { matchId: string };
    toast("Match started — opening replay…", "success");
    router.push(`/replay/${json.matchId}`);
  }

  const own = bots.filter((b) => b.isOwn);
  const others = bots.filter((b) => !b.isOwn);

  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--bg)", padding: "8px 0", display: "flex", gap: 12, alignItems: "center", borderBottom: "1px solid var(--border)" }}>
        <span><b>{picked.size}</b> / {MAX_BOTS} selected (min {MIN_BOTS})</span>
        <button className="primary" onClick={start} disabled={busy || picked.size < MIN_BOTS} style={{ minWidth: 140 }}>
          {busy ? "Starting…" : "Start match"}
        </button>
        {picked.size > 0 && (
          <button onClick={() => setPicked(new Set())} disabled={busy}>Clear</button>
        )}
        {error && <span style={{ color: "var(--red, #e78284)" }}>{error}</span>}
      </div>

      {own.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h2>My bots</h2>
          <BotGrid rows={own} picked={picked} onToggle={toggle} />
        </section>
      )}
      <section style={{ marginTop: 24 }}>
        <h2>Sample / public bots</h2>
        <BotGrid rows={others} picked={picked} onToggle={toggle} />
      </section>
    </div>
  );
}

function BotGrid({ rows, picked, onToggle }: { rows: BotRow[]; picked: Set<string>; onToggle: (id: string) => void }) {
  if (rows.length === 0) return <p style={{ color: "var(--fg-dim)" }}>None.</p>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
      {rows.map((b) => {
        const on = picked.has(b.id);
        return (
          <button
            key={b.id}
            onClick={() => onToggle(b.id)}
            className={on ? "primary" : ""}
            style={{ textAlign: "left", padding: "8px 12px" }}
          >
            <div style={{ fontWeight: 600 }}>{b.name}</div>
            <div style={{ fontSize: "0.8em", color: on ? "inherit" : "var(--fg-dim)" }}>
              {b.isOfficial ? "official" : (b.isOwn ? "mine" : "public")}
            </div>
          </button>
        );
      })}
    </div>
  );
}
