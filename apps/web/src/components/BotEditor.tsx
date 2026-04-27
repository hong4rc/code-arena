"use client";
import dynamic from "next/dynamic";
import { useState } from "react";

const Monaco = dynamic(() => import("@monaco-editor/react").then((m) => m.default), { ssr: false });

interface Props {
  botId?: string;
  initialName: string;
  initialCode: string;
}

export function BotEditor({ botId, initialName, initialCode }: Props) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<{ level: string; code: string; message: string }[]>([]);
  const [savedId, setSavedId] = useState<string | null>(botId ?? null);

  async function remove() {
    if (!savedId) return;
    if (!globalThis.confirm(`Delete bot "${name}"? Past matches stay but this bot is gone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bots/${savedId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        globalThis.alert(`Delete failed: ${json.error ?? res.status}`);
        return;
      }
      window.location.href = "/bots";
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setIssues([]);
    try {
      const res = await fetch(savedId ? `/api/bots/${savedId}` : `/api/bots`, {
        method: savedId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, code }),
      });
      const json = await res.json();
      if (!res.ok) {
        setIssues(json.issues ?? [{ level: "error", code: "save", message: json.error ?? "save failed" }]);
        return;
      }
      setSavedId(json.botId);
      setIssues(json.issues ?? []);
      if (!botId) window.location.href = `/bots/${json.botId}`;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="bot name" />
        <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        {savedId ? (
          <button className="danger" onClick={remove} disabled={busy} style={{ minWidth: 110 }}>
            {busy ? "Deleting…" : "Delete bot"}
          </button>
        ) : null}
      </div>
      <div style={{ height: 480, border: "1px solid #ddd", borderRadius: 6 }}>
        <Monaco
          height="100%"
          defaultLanguage="javascript"
          value={code}
          onChange={(v) => setCode(v ?? "")}
          options={{ minimap: { enabled: false }, fontSize: 13 }}
        />
      </div>
      {issues.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h3>Validation</h3>
          <ul>
            {issues.map((i, k) => (
              <li key={k} style={{ color: i.level === "error" ? "#c00" : "#a60" }}>
                <code>{i.code}</code>: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
