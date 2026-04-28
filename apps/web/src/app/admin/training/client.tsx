"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useToast } from "@/components/ui/Toast";

interface BotRow {
  id: string;
  name: string;
  ownerId: string;
  isOfficial: boolean;
  isTrainingTarget: boolean;
  matches: number;
  wins: number;
  winRate: number;
  avgPlacement: number | null;
}

export function TrainingClient({ rows }: { rows: BotRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showOnlyTraining, setShowOnlyTraining] = useState(false);

  async function toggle(id: string, on: boolean, name: string) {
    setBusyId(id);
    const res = await fetch(`/api/admin/training/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on }),
    });
    setBusyId(null);
    if (!res.ok) { toast(`Toggle failed (${res.status})`, "error"); return; }
    toast(on ? `Started training ${name}` : `Stopped training ${name}`, "success");
    start(() => router.refresh());
  }

  const enabled = rows.filter((b) => b.isTrainingTarget);
  const q = filter.trim().toLowerCase();
  const visible = rows.filter((b) => {
    if (showOnlyTraining && !b.isTrainingTarget) return false;
    if (q && !b.name.toLowerCase().includes(q)) return false;
    return true;
  });
  return (
    <div>
      <p style={{ color: "var(--fg-muted)" }}>
        Currently training: <b>{enabled.length}</b>{enabled.length > 0 ? ` — ${enabled.map((b) => b.name).join(", ")}` : ""}
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <input
          placeholder="Filter by name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, maxWidth: 320 }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.9em", color: "var(--fg-muted)" }}>
          <input type="checkbox" checked={showOnlyTraining} onChange={(e) => setShowOnlyTraining(e.target.checked)} />
          training only
        </label>
        <span style={{ marginLeft: "auto", fontSize: "0.85em", color: "var(--fg-dim)" }}>
          {visible.length} / {rows.length} bots
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th style={{ textAlign: "right" }}>Matches</th>
            <th style={{ textAlign: "right" }}>Top-1 win%</th>
            <th style={{ textAlign: "right" }}>Avg place</th>
            <th>Trainer</th>
            <th>Params</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((b) => (
            <tr key={b.id} style={{ background: b.isTrainingTarget ? "rgba(166, 209, 137, 0.08)" : undefined }}>
              <td>
                <div>{b.name}</div>
                <div style={{ fontSize: "0.75em", color: "var(--fg-dim)" }}>
                  <code>{b.ownerId}</code>
                </div>
              </td>
              <td>{b.isOfficial ? "official" : "user"}</td>
              <td style={{ textAlign: "right", color: "var(--fg-dim)" }}>
                {b.matches > 0 ? b.matches : "—"}
              </td>
              <td style={{ textAlign: "right", fontWeight: 600, color: winColor(b.winRate, b.matches) }}>
                {b.matches >= 5 ? `${(b.winRate * 100).toFixed(1)}%` : "—"}
                {b.matches >= 5 && (
                  <div style={{ fontSize: "0.7em", color: "var(--fg-dim)", fontWeight: 400 }}>
                    {b.wins}/{b.matches}
                  </div>
                )}
              </td>
              <td style={{ textAlign: "right", color: "var(--fg-dim)" }}>
                {b.avgPlacement === null ? "—" : b.avgPlacement.toFixed(2)}
              </td>
              <td>
                <button
                  className={b.isTrainingTarget ? "" : "primary"}
                  onClick={() => toggle(b.id, !b.isTrainingTarget, b.name)}
                  disabled={pending || busyId !== null}
                  style={{ minWidth: 110 }}
                >
                  {busyId === b.id ? "…" : (b.isTrainingTarget ? "Stop training" : "Start training")}
                </button>
              </td>
              <td>
                <details className="dl-menu">
                  <summary>Download ▾</summary>
                  <div className="dl-menu-list">
                    <a href={`/api/admin/bots/${b.id}/params`} download>Latest params</a>
                    <a href={`/api/admin/bots/${b.id}/params?history=20`} download>Last 20 versions</a>
                    <a href={`/api/admin/bots/${b.id}/params?history=200`} download>All versions</a>
                    <button type="button" onClick={() => { void globalThis.navigator.clipboard.writeText(b.id); toast("Bot UUID copied", "success"); }}>
                      Copy UUID
                    </button>
                  </div>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Green = strong, yellow = average, red = weak. Grey if too few matches to know.
function winColor(rate: number, matches: number): string {
  if (matches < 5) return "var(--fg-dim)";
  if (rate >= 0.5) return "var(--green, #a6d189)";
  if (rate >= 0.25) return "var(--yellow, #e5c890)";
  return "var(--red, #e78284)";
}
