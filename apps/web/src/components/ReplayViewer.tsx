"use client";
import { useEffect, useMemo, useRef, useState } from "react";

interface BotSnap { id: string; x: number; y: number; size?: number; hp: number; alive: boolean; inventory: string[] }
interface ItemSnap { id: string; kind: string; x: number; y: number }
interface BulletSnap { id: string; x: number; y: number; vx: number; vy: number; ownerId: string }
interface ZoneSnap { xMin: number; yMin: number; xMax: number; yMax: number }
interface ResolvedAction {
  botId: string;
  attempted: { type: string; dir?: "UP" | "DOWN" | "LEFT" | "RIGHT"; item?: string };
  applied: { type: string; dir?: "UP" | "DOWN" | "LEFT" | "RIGHT" };
  reason?: string;
}
interface TickReplay {
  tick: number;
  actions?: ResolvedAction[];
  worldSnapshot: {
    bots: BotSnap[];
    items: ItemSnap[];
    bullets?: BulletSnap[];
    zone?: ZoneSnap;
    nextZone?: ZoneSnap | null;
    nextShrinkAtTick?: number | null;
  };
}

interface Props {
  matchId: string;
  initialTicks: TickReplay[] | null;
  live: boolean;
  /** Map of bot id → display name. Falls back to short id when missing. */
  botNames?: Record<string, string>;
}

// Catppuccin Frappé palette for distinct bot colors.
const BOT_PALETTE = [
  "#f4b8e4", // pink
  "#8caaee", // blue
  "#a6d189", // green
  "#ef9f76", // peach
  "#e5c890", // yellow
  "#ca9ee6", // mauve
  "#e78284", // red
  "#81c8be", // teal
  "#85c1dc", // sapphire
  "#babbf1", // lavender
];

const ITEM_GLYPH: Record<string, { glyph: string; color: string }> = {
  HEAL: { glyph: "♥", color: "#a6d189" },
  WEAPON: { glyph: "⚔", color: "#e78284" },
  SHIELD: { glyph: "◇", color: "#85c1dc" },
  SPEED_BOOST: { glyph: "⚡", color: "#ef9f76" },
};

const DIR_DELTA: Record<string, [number, number]> = {
  UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0],
};

// Adapt cell size to map size — bigger maps need smaller cells to fit on screen.
function cellSizeFor(width: number, height: number): number {
  const max = Math.max(width, height);
  if (max <= 12) return 36;
  if (max <= 20) return 28;
  if (max <= 32) return 22;
  if (max <= 50) return 14;
  if (max <= 80) return 9;
  if (max <= 100) return 7;
  return 5;
}

// Minimum on-screen size for entities, regardless of cell size. Bots are
// always rendered visibly larger than items so they're easy to track.
const MIN_BOT_PX = 26;
const MIN_ITEM_PX = 14;
const MAX_HP = 100;

function shortId(id: string): string {
  // bot1-greedy-bot → greedy
  const parts = id.split("-");
  return parts.length > 2 ? parts[1]! : id.slice(0, 6);
}

export function ReplayViewer({ matchId, initialTicks, live, botNames = {} }: Props) {
  const [ticks, setTicks] = useState<TickReplay[]>(initialTicks ?? []);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showFow, setShowFow] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Live tick streaming
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

  // Auto-play
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setIdx((i) => {
        if (i >= ticks.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 100); // 10 ticks/sec, matching the engine's real-time tempo
    return () => clearInterval(id);
  }, [playing, ticks.length]);

  // Map bot id → stable color/index
  const botMeta = useMemo(() => {
    const ids = new Set<string>();
    for (const t of ticks) for (const b of t.worldSnapshot.bots) ids.add(b.id);
    const sorted = [...ids].sort();
    const map = new Map<string, { color: string; index: number; label: string; tooltip: string }>();
    for (const [i, id] of sorted.entries()) {
      const name = botNames[id];
      const label = name ?? shortId(id);
      const tooltip = name ? `${name} · ${id}` : id;
      map.set(id, { color: BOT_PALETTE[i % BOT_PALETTE.length]!, index: i + 1, label, tooltip });
    }
    return map;
  }, [ticks, botNames]);

  const current = ticks[idx];
  const bounds = useMemo(() => {
    let w = 20, h = 20;
    for (const t of ticks) {
      for (const b of t.worldSnapshot.bots) {
        w = Math.max(w, b.x + 1);
        h = Math.max(h, b.y + 1);
      }
      for (const it of t.worldSnapshot.items) {
        w = Math.max(w, it.x + 1);
        h = Math.max(h, it.y + 1);
      }
    }
    return { w, h };
  }, [ticks]);

  // Render
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs || !current) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    const CELL = cellSizeFor(bounds.w, bounds.h);
    const W = bounds.w * CELL;
    const H = bounds.h * CELL;
    cvs.width = W;
    cvs.height = H;

    // Background — outside-zone area is danger red
    ctx.fillStyle = "#3a2a30"; // very dark danger background
    ctx.fillRect(0, 0, W, H);

    // Safe zone — Frappé base (the rest of the map is the danger background above)
    const zone = current.worldSnapshot.zone;
    if (zone) {
      const zw = (zone.xMax - zone.xMin + 1) * CELL;
      const zh = (zone.yMax - zone.yMin + 1) * CELL;
      if (zw > 0 && zh > 0) {
        ctx.fillStyle = "#303446"; // Frappé base — safe area
        ctx.fillRect(zone.xMin * CELL, zone.yMin * CELL, zw, zh);
        // Glowing border to mark the zone edge
        ctx.strokeStyle = "rgba(143, 188, 187, 0.7)"; // teal-ish
        ctx.lineWidth = 2;
        ctx.strokeRect(zone.xMin * CELL, zone.yMin * CELL, zw, zh);
      }
    } else {
      // Fallback for old replays without zone data: full map = safe
      ctx.fillStyle = "#303446";
      ctx.fillRect(0, 0, W, H);
    }

    // Next-zone preview — dashed white-ish border like PUBG's white circle
    const nextZone = current.worldSnapshot.nextZone;
    if (nextZone) {
      const nzw = (nextZone.xMax - nextZone.xMin + 1) * CELL;
      const nzh = (nextZone.yMax - nextZone.yMin + 1) * CELL;
      if (nzw > 0 && nzh > 0) {
        ctx.save();
        ctx.strokeStyle = "rgba(245, 245, 245, 0.8)"; // off-white preview
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(nextZone.xMin * CELL + 1, nextZone.yMin * CELL + 1, nzw - 2, nzh - 2);
        ctx.restore();
      }
    }

    // Major grid every 10 cells — full per-cell lines turn the canvas into noise
    // on a 100×100 board. Reference lines are enough for orientation.
    ctx.strokeStyle = "#414559"; // Surface 0
    ctx.lineWidth = 1;
    for (let x = 0; x <= bounds.w; x += 10) {
      ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, H); ctx.stroke();
    }
    for (let y = 0; y <= bounds.h; y += 10) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(W, y * CELL); ctx.stroke();
    }

    // Items — render at MIN_ITEM_PX even on small cells so they're visible.
    const itemPx = Math.max(CELL, MIN_ITEM_PX);
    const itemRadius = itemPx / 2 - 2;
    for (const it of current.worldSnapshot.items) {
      const meta = ITEM_GLYPH[it.kind] ?? { glyph: "?", color: "#ccc" };
      const cx = it.x * CELL + CELL / 2;
      const cy = it.y * CELL + CELL / 2;
      ctx.fillStyle = meta.color + "33"; // ~20% alpha halo
      ctx.beginPath();
      ctx.arc(cx, cy, itemRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = meta.color;
      ctx.font = `bold ${Math.floor(itemPx * 0.55)}px system-ui, -apple-system`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(meta.glyph, cx, cy + 1);
    }

    // Attack rays — draw a flash from each attacker to its target cell.
    if (current.actions) {
      ctx.lineWidth = 3;
      for (const a of current.actions) {
        if (a.applied.type !== "ATTACK" || !a.applied.dir) continue;
        const attacker = current.worldSnapshot.bots.find((b) => b.id === a.botId);
        if (!attacker) continue;
        const [dx, dy] = DIR_DELTA[a.applied.dir]!;
        const fromX = attacker.x * CELL + CELL / 2;
        const fromY = attacker.y * CELL + CELL / 2;
        const toX = (attacker.x + dx * 2) * CELL + CELL / 2;
        const toY = (attacker.y + dy * 2) * CELL + CELL / 2;
        const grad = ctx.createLinearGradient(fromX, fromY, toX, toY);
        grad.addColorStop(0, "rgba(231, 130, 132, 0.8)");
        grad.addColorStop(1, "rgba(231, 130, 132, 0)");
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();
      }
    }

    // Fog of war (optional overlay)
    if (showFow) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(0, 0, W, H);
      // Cut holes for each alive bot's 5x5 vision
      ctx.globalCompositeOperation = "destination-out";
      for (const b of current.worldSnapshot.bots) {
        if (!b.alive) continue;
        ctx.fillStyle = "rgba(0,0,0,1)";
        const grad = ctx.createRadialGradient(
          b.x * CELL + CELL / 2, b.y * CELL + CELL / 2, 0,
          b.x * CELL + CELL / 2, b.y * CELL + CELL / 2, CELL * 2.5,
        );
        grad.addColorStop(0, "rgba(0,0,0,1)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x * CELL + CELL / 2, b.y * CELL + CELL / 2, CELL * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // Bullets — small bright projectile with a directional tail
    const bullets = current.worldSnapshot.bullets ?? [];
    for (const bullet of bullets) {
      const cx = bullet.x * CELL + CELL / 2;
      const cy = bullet.y * CELL + CELL / 2;
      const owner = botMeta.get(bullet.ownerId);
      const color = owner?.color ?? "#fff";

      // Trailing motion line so direction is obvious. Normalize the velocity
      // vector to a unit length so the tail looks the same at any angle.
      const mag = Math.hypot(bullet.vx, bullet.vy) || 1;
      const ux = bullet.vx / mag;
      const uy = bullet.vy / mag;
      const tailLen = CELL * 0.8;
      const tailX = cx - ux * tailLen;
      const tailY = cy - uy * tailLen;
      const grad = ctx.createLinearGradient(tailX, tailY, cx, cy);
      grad.addColorStop(0, color + "00");
      grad.addColorStop(1, color + "ff");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(cx, cy);
      ctx.stroke();

      // Bullet head
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, CELL / 7), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, CELL / 14), 0, Math.PI * 2);
      ctx.fill();
    }

    // Bots — multi-cell rounded rect, HP bar, name label.
    // Render at a minimum on-screen size so they're always larger than items.
    for (const b of current.worldSnapshot.bots) {
      const meta = botMeta.get(b.id) ?? { color: "#888", index: 0, label: b.id };
      const size = b.size ?? 1;
      const footprintPx = size * CELL;
      const w = Math.max(footprintPx, MIN_BOT_PX);
      const h = w;
      // Center the visual on the footprint center (not top-left), so the
      // rendered body is always bigger than the underlying cells but stays aligned.
      const fx = b.x * CELL + footprintPx / 2;
      const fy = b.y * CELL + footprintPx / 2;
      const px = fx - w / 2;
      const py = fy - h / 2;
      const cx = fx;
      const cy = fy;
      const pad = 4;

      if (!b.alive) {
        // Translucent grave + red X covering the whole footprint
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.beginPath();
        ctx.roundRect(px + pad, py + pad, w - pad * 2, h - pad * 2, 6);
        ctx.fill();
        ctx.strokeStyle = "rgba(231, 130, 132, 0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px + pad, py + pad); ctx.lineTo(px + w - pad, py + h - pad); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px + w - pad, py + pad); ctx.lineTo(px + pad, py + h - pad); ctx.stroke();
        continue;
      }

      // Body — rounded rect filling the full footprint
      ctx.fillStyle = meta.color;
      ctx.beginPath();
      ctx.roundRect(px + pad, py + pad, w - pad * 2, h - pad * 2, 8);
      ctx.fill();
      ctx.strokeStyle = "#232634";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Bot index in the center
      ctx.fillStyle = "#232634";
      ctx.font = `bold ${Math.floor(Math.min(w, h) * 0.4)}px system-ui, -apple-system`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(meta.index), cx, cy);

      // HP bar across the top of the footprint
      const barW = w - 10;
      const barH = 5;
      const barX = px + 5;
      const barY = py + 2;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(barX, barY, barW, barH);
      const hpPct = Math.max(0, b.hp) / MAX_HP;
      ctx.fillStyle = hpPct > 0.5 ? "#a6d189" : (hpPct > 0.25 ? "#e5c890" : "#e78284");
      ctx.fillRect(barX, barY, barW * hpPct, barH);

      // Name label above the bot (so colours + names line up with the panel).
      ctx.font = "600 11px system-ui, -apple-system";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const labelY = py - 4;
      ctx.fillStyle = "rgba(35, 38, 52, 0.85)";
      const tw = ctx.measureText(meta.label).width;
      ctx.fillRect(cx - tw / 2 - 4, labelY - 12, tw + 8, 14);
      ctx.fillStyle = meta.color;
      ctx.fillText(meta.label, cx, labelY);
    }
  }, [current, bounds, botMeta, showFow]);

  if (ticks.length === 0) return <p>{live ? "Waiting for first tick…" : "No replay data."}</p>;

  const isLastTick = idx === ticks.length - 1;
  const aliveCount = current?.worldSnapshot.bots.filter((b) => b.alive).length ?? 0;
  const winner = isLastTick && aliveCount === 1
    ? current?.worldSnapshot.bots.find((b) => b.alive)
    : null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button onClick={() => { setIdx(0); setPlaying(true); }} className="btn">
          ⏮ Replay
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          className="btn primary"
          disabled={isLastTick && !playing}
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button onClick={() => setShowFow((f) => !f)} className="btn" style={{ marginLeft: "auto" }}>
          {showFow ? "👁 Show full map" : "🌫 Fog of war"}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, fontFamily: "ui-monospace" }}>
        <span style={{ minWidth: 120 }}>
          Tick <b>{idx + 1}</b> / {ticks.length}
        </span>
        {(() => {
          const z = current?.worldSnapshot;
          if (!z?.nextShrinkAtTick) return null;
          const ticksLeft = z.nextShrinkAtTick - (current?.tick ?? 0);
          if (ticksLeft <= 0) return null;
          return (
            <span style={{ color: "var(--peach)" }}>
              ⚠ zone closes in <b>{ticksLeft}</b> ticks ({(ticksLeft / 10).toFixed(1)}s)
            </span>
          );
        })()}
        <input
          type="range"
          min={0}
          max={Math.max(0, ticks.length - 1)}
          value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
          style={{ flex: 1 }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, alignItems: "start" }}>
        <canvas
          ref={canvasRef}
          style={{
            background: "#303446",
            border: "1px solid var(--border)",
            borderRadius: 8,
            imageRendering: "pixelated",
            display: "block",
          }}
        />
        <div>
          {winner && (
            <div className="card" style={{ borderColor: "var(--green)", background: "rgba(166, 209, 137, 0.08)" }}>
              <h3 style={{ margin: 0, color: "var(--green)" }}>🏆 Winner</h3>
              <p style={{ marginTop: 4, marginBottom: 0 }}>
                <b
                  style={{ color: botMeta.get(winner.id)?.color ?? "var(--text)" }}
                  title={botMeta.get(winner.id)?.tooltip ?? winner.id}
                >
                  {botMeta.get(winner.id)?.label ?? winner.id}
                </b> survived with {winner.hp} HP.
              </p>
            </div>
          )}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Bot</th><th>HP</th><th>Pos</th><th>Items</th>
                </tr>
              </thead>
              <tbody>
                {current!.worldSnapshot.bots.map((b) => {
                  const meta = botMeta.get(b.id);
                  return (
                    <tr key={b.id} style={{ opacity: b.alive ? 1 : 0.45 }} title={meta?.tooltip ?? b.id}>
                      <td>
                        <span style={{
                          display: "inline-block", width: 18, height: 18, borderRadius: "50%",
                          background: meta?.color ?? "#888", color: "#232634",
                          fontWeight: 700, fontSize: 11, textAlign: "center", lineHeight: "18px",
                        }}>{meta?.index}</span>
                      </td>
                      <td style={{ color: meta?.color ?? "var(--text)" }}>{meta?.label ?? b.id}</td>
                      <td>{b.alive ? b.hp : <span style={{ color: "var(--red)" }}>KO</span>}</td>
                      <td style={{ color: "var(--fg-dim)" }}>({b.x},{b.y})</td>
                      <td>
                        {b.inventory.length === 0 ? (
                          <span style={{ color: "var(--fg-dim)" }}>—</span>
                        ) : b.inventory.map((it, k) => {
                          const ig = ITEM_GLYPH[it];
                          return ig ? (
                            <span key={k} title={it} style={{ color: ig.color, marginRight: 4, fontSize: "1.1em" }}>{ig.glyph}</span>
                          ) : (<code key={k}>{it}</code>);
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", color: "var(--fg-muted)" }}>
          Tick {idx + 1} actions ({current?.actions?.length ?? 0})
        </summary>
        <div className="card" style={{ marginTop: 8, fontFamily: "ui-monospace", fontSize: "0.85em" }}>
          {current?.actions?.map((a, k) => {
            const meta = botMeta.get(a.botId);
            return (
              <div key={k} style={{ padding: "4px 0", color: a.reason ? "var(--peach)" : "var(--fg-muted)" }}>
                <span style={{ color: meta?.color, fontWeight: 600 }} title={meta?.tooltip ?? a.botId}>{meta?.label ?? a.botId}</span>
                {" → "}
                <code>{a.applied.type}{a.applied.dir ? ` ${a.applied.dir}` : ""}</code>
                {a.reason && <span style={{ marginLeft: 8 }}>(blocked: {a.reason})</span>}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
