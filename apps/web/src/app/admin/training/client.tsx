"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface BotRow {
  id: string;
  name: string;
  ownerId: string;
  isOfficial: boolean;
  isTrainingTarget: boolean;
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
          <tr><th>Name</th><th>Owner</th><th>Type</th><th>Trainer</th><th>Params</th></tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id} style={{ background: b.isTrainingTarget ? "rgba(166, 209, 137, 0.08)" : undefined }}>
              <td>{b.name}</td>
              <td><code style={{ color: "var(--fg-dim)" }}>{b.ownerId}</code></td>
              <td>{b.isOfficial ? "official" : "user"}</td>
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
              <td style={{ display: "flex", gap: 8 }}>
                <a href={`/api/admin/bots/${b.id}/params`} download style={{ fontSize: "0.85em" }}>
                  ⇩ latest
                </a>
                <a href={`/api/admin/bots/${b.id}/params?history=20`} download style={{ fontSize: "0.85em", color: "var(--fg-dim)" }}>
                  history×20
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
