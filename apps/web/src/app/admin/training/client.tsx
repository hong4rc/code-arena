"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggle(id: string, on: boolean) {
    setBusyId(id);
    const res = await fetch(`/api/admin/training/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on }),
    });
    setBusyId(null);
    if (!res.ok) { globalThis.alert(`Toggle failed: ${res.status}`); return; }
    start(() => router.refresh());
  }

  const enabled = rows.filter((b) => b.isTrainingTarget);
  return (
    <div>
      <p style={{ color: "var(--fg-muted)" }}>
        Currently training: <b>{enabled.length}</b>{enabled.length > 0 ? ` — ${enabled.map((b) => b.name).join(", ")}` : ""}
      </p>
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
          {rows.map((b) => (
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
                  onClick={() => toggle(b.id, !b.isTrainingTarget)}
                  disabled={pending || busyId !== null}
                  style={{ minWidth: 110 }}
                >
                  {busyId === b.id ? "…" : (b.isTrainingTarget ? "Stop training" : "Start training")}
                </button>
              </td>
              <td style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <a href={`/api/admin/bots/${b.id}/params`} download style={{ fontSize: "0.85em" }}>⇩ latest</a>
                <a href={`/api/admin/bots/${b.id}/params?history=20`} download style={{ fontSize: "0.85em", color: "var(--fg-dim)" }}>history</a>
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
