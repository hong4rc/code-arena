"use client";
import { useEffect, useMemo, useRef, useState } from "react";

interface BotSnap { id: string; x: number; y: number; hp: number; alive: boolean; inventory: string[] }
interface ItemSnap { id: string; kind: string; x: number; y: number }
interface TickReplay {
  tick: number;
  worldSnapshot: { bots: BotSnap[]; items: ItemSnap[] };
}

interface Props {
  matchId: string;
  initialTicks: TickReplay[] | null;
  live: boolean;
}

const CELL = 24;

export function ReplayViewer({ matchId, initialTicks, live }: Props) {
  const [ticks, setTicks] = useState<TickReplay[]>(initialTicks ?? []);
  const [idx, setIdx] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!live) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws/match/${matchId}`);
    const onMessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data as string) as TickReplay;
        setTicks((prev) => {
          const next = [...prev, msg];
          setIdx(next.length - 1);
          return next;
        });
      } catch { /* ignore */ }
    };
    ws.addEventListener("message", onMessage);
    return () => {
      ws.removeEventListener("message", onMessage);
      ws.close();
    };
  }, [live, matchId]);

  const current = ticks[idx];
  const bounds = useMemo(() => {
    let w = 20, h = 20;
    for (const t of ticks) {
      for (const b of t.worldSnapshot.bots) {
        w = Math.max(w, b.x + 1);
        h = Math.max(h, b.y + 1);
      }
    }
    return { w, h };
  }, [ticks]);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs || !current) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    cvs.width = bounds.w * CELL;
    cvs.height = bounds.h * CELL;
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.strokeStyle = "#eee";
    for (let x = 0; x <= bounds.w; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, bounds.h * CELL); ctx.stroke();
    }
    for (let y = 0; y <= bounds.h; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(bounds.w * CELL, y * CELL); ctx.stroke();
    }
    const itemColor: Record<string, string> = { HEAL: "#2c2", WEAPON: "#c22", SHIELD: "#2af", SPEED_BOOST: "#fa0" };
    for (const it of current.worldSnapshot.items) {
      ctx.fillStyle = itemColor[it.kind] ?? "#888";
      ctx.fillRect(it.x * CELL + 6, it.y * CELL + 6, CELL - 12, CELL - 12);
    }
    for (const b of current.worldSnapshot.bots) {
      if (!b.alive) continue;
      ctx.fillStyle = "#222";
      ctx.beginPath();
      ctx.arc(b.x * CELL + CELL / 2, b.y * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "10px ui-monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(b.hp), b.x * CELL + CELL / 2, b.y * CELL + CELL / 2 + 3);
    }
  }, [current, bounds]);

  if (ticks.length === 0) return <p>{live ? "Waiting for first tick…" : "No replay data."}</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <span>Tick {idx + 1} / {ticks.length}</span>
        <input type="range" min={0} max={Math.max(0, ticks.length - 1)} value={idx} onChange={(e) => setIdx(Number(e.target.value))} style={{ flex: 1 }} />
      </div>
      <canvas ref={canvasRef} style={{ background: "white", border: "1px solid #ddd" }} />
      <table style={{ marginTop: 12 }}>
        <thead><tr><th>Bot</th><th>HP</th><th>Pos</th><th>Inventory</th></tr></thead>
        <tbody>
          {current!.worldSnapshot.bots.map((b) => (
            <tr key={b.id}><td>{b.id}</td><td>{b.hp}{b.alive ? "" : " (KO)"}</td><td>({b.x},{b.y})</td><td>{b.inventory.join(", ") || "—"}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
