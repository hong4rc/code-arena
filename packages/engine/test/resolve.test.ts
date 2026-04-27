import { describe, expect, test } from "bun:test";
import {
  buildObservation,
  createWorld,
  isGameOver,
  mergeConfig,
  placements,
  resolveTick,
} from "../src/index.ts";
import type { Bot, BotInput, GameConfig, World } from "../src/index.ts";

const cfg: GameConfig = mergeConfig({ width: 10, height: 10, maxTicks: 10 });

function placeBot(world: World, id: string, x: number, y: number, mut: Partial<Bot> = {}): void {
  const b = world.bots.get(id);
  if (!b) throw new Error("no bot " + id);
  b.pos = { x, y };
  Object.assign(b, mut);
}

describe("createWorld", () => {
  test("places all bots at unique cells", () => {
    const w = createWorld({ botIds: ["a", "b", "c", "d", "e"], config: cfg, seed: 42 });
    const seen = new Set<string>();
    for (const b of w.bots.values()) {
      const k = `${b.pos.x},${b.pos.y}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  test("is deterministic given a seed", () => {
    const w1 = createWorld({ botIds: ["a", "b", "c"], config: cfg, seed: 7 });
    const w2 = createWorld({ botIds: ["a", "b", "c"], config: cfg, seed: 7 });
    for (const id of ["a", "b", "c"]) {
      expect(w1.bots.get(id)?.pos).toEqual(w2.bots.get(id)?.pos);
    }
  });
});

describe("MOVE", () => {
  test("simple move updates position", () => {
    const w = createWorld({ botIds: ["a"], config: cfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    resolveTick(w, [{ botId: "a", action: { type: "MOVE", dir: "RIGHT" } }], cfg);
    expect(w.bots.get("a")?.pos).toEqual({ x: 6, y: 5 });
  });

  test("off-grid move is downgraded to WAIT", () => {
    const w = createWorld({ botIds: ["a"], config: cfg, seed: 1 });
    placeBot(w, "a", 0, 0);
    const r = resolveTick(w, [{ botId: "a", action: { type: "MOVE", dir: "LEFT" } }], cfg);
    expect(w.bots.get("a")?.pos).toEqual({ x: 0, y: 0 });
    expect(r[0]?.applied.type).toBe("WAIT");
    expect(r[0]?.reason).toBe("off-grid");
  });

  test("two bots moving into the same cell both stay put", () => {
    const w = createWorld({ botIds: ["a", "b"], config: cfg, seed: 1 });
    placeBot(w, "a", 4, 5);
    placeBot(w, "b", 6, 5);
    const inputs: BotInput[] = [
      { botId: "a", action: { type: "MOVE", dir: "RIGHT" } },
      { botId: "b", action: { type: "MOVE", dir: "LEFT" } },
    ];
    const r = resolveTick(w, inputs, cfg);
    expect(w.bots.get("a")?.pos).toEqual({ x: 4, y: 5 });
    expect(w.bots.get("b")?.pos).toEqual({ x: 6, y: 5 });
    for (const ra of r) if (ra.attempted.type === "MOVE") expect(ra.reason).toBe("blocked-by-bot");
  });

  test("move into stationary bot is blocked", () => {
    const w = createWorld({ botIds: ["a", "b"], config: cfg, seed: 1 });
    placeBot(w, "a", 4, 5);
    placeBot(w, "b", 5, 5);
    const r = resolveTick(w, [{ botId: "a", action: { type: "MOVE", dir: "RIGHT" } }], cfg);
    expect(w.bots.get("a")?.pos).toEqual({ x: 4, y: 5 });
    expect(r.find((x) => x.botId === "a")?.reason).toBe("blocked-by-bot");
  });
});

describe("ATTACK", () => {
  test("melee attack hits adjacent target", () => {
    const w = createWorld({ botIds: ["a", "b"], config: cfg, seed: 1 });
    placeBot(w, "a", 4, 5);
    placeBot(w, "b", 5, 5);
    resolveTick(w, [{ botId: "a", action: { type: "ATTACK", dir: "RIGHT" } }], cfg);
    expect(w.bots.get("b")?.hp).toBe(cfg.startHp - cfg.startAttack);
  });

  test("attack with no target is downgraded to WAIT", () => {
    const w = createWorld({ botIds: ["a"], config: cfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    const r = resolveTick(w, [{ botId: "a", action: { type: "ATTACK", dir: "UP" } }], cfg);
    expect(r[0]?.applied.type).toBe("WAIT");
    expect(r[0]?.reason).toBe("no-target-in-range");
  });

  test("simultaneous attack damages both", () => {
    const w = createWorld({ botIds: ["a", "b"], config: cfg, seed: 1 });
    placeBot(w, "a", 4, 5);
    placeBot(w, "b", 5, 5);
    resolveTick(
      w,
      [
        { botId: "a", action: { type: "ATTACK", dir: "RIGHT" } },
        { botId: "b", action: { type: "ATTACK", dir: "LEFT" } },
      ],
      cfg,
    );
    expect(w.bots.get("a")?.hp).toBe(cfg.startHp - cfg.startAttack);
    expect(w.bots.get("b")?.hp).toBe(cfg.startHp - cfg.startAttack);
  });

  test("WEAPON inventory item extends range and damage", () => {
    const w = createWorld({ botIds: ["a", "b"], config: cfg, seed: 1 });
    placeBot(w, "a", 3, 5, { inventory: ["WEAPON"] });
    placeBot(w, "b", 5, 5);
    resolveTick(w, [{ botId: "a", action: { type: "ATTACK", dir: "RIGHT" } }], cfg);
    const expected = cfg.startHp - (cfg.startAttack + cfg.items.weapon.attackBonus);
    expect(w.bots.get("b")?.hp).toBe(expected);
  });

  test("attack kills and marks bot not alive", () => {
    const w = createWorld({ botIds: ["a", "b"], config: cfg, seed: 1 });
    placeBot(w, "a", 4, 5);
    placeBot(w, "b", 5, 5, { hp: 5 });
    resolveTick(w, [{ botId: "a", action: { type: "ATTACK", dir: "RIGHT" } }], cfg);
    expect(w.bots.get("b")?.alive).toBe(false);
  });
});

describe("USE / inventory", () => {
  test("USE HEAL restores HP, capped at max", () => {
    const w = createWorld({ botIds: ["a"], config: cfg, seed: 1 });
    placeBot(w, "a", 5, 5, { hp: 50, inventory: ["HEAL"] });
    resolveTick(w, [{ botId: "a", action: { type: "USE", item: "HEAL" } }], cfg);
    const a = w.bots.get("a");
    expect(a?.hp).toBe(50 + cfg.items.heal.hp);
    expect(a?.inventory).toEqual([]);
  });

  test("USE without item in inventory → WAIT + reason", () => {
    const w = createWorld({ botIds: ["a"], config: cfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    const r = resolveTick(w, [{ botId: "a", action: { type: "USE", item: "HEAL" } }], cfg);
    expect(r[0]?.applied.type).toBe("WAIT");
    expect(r[0]?.reason).toBe("item-not-in-inventory");
    expect(w.bots.get("a")?.hp).toBe(cfg.startHp);
  });

  test("USE SHIELD absorbs incoming damage", () => {
    const w = createWorld({ botIds: ["a", "b"], config: cfg, seed: 1 });
    placeBot(w, "a", 4, 5, { inventory: ["SHIELD"] });
    placeBot(w, "b", 5, 5);
    resolveTick(
      w,
      [
        { botId: "a", action: { type: "USE", item: "SHIELD" } },
        { botId: "b", action: { type: "ATTACK", dir: "LEFT" } },
      ],
      cfg,
    );
    expect(w.bots.get("a")?.hp).toBe(cfg.startHp);
    expect(w.bots.get("a")?.shieldHp).toBe(cfg.items.shield.absorbHp - cfg.startAttack);
  });
});

describe("PICKUP", () => {
  test("PICKUP on empty cell → WAIT", () => {
    const w = createWorld({ botIds: ["a"], config: cfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    const r = resolveTick(w, [{ botId: "a", action: { type: "PICKUP" } }], cfg);
    expect(r[0]?.applied.type).toBe("WAIT");
    expect(r[0]?.reason).toBe("no-item-here");
  });

  test("PICKUP grabs an item present on bot's cell", () => {
    const w = createWorld({ botIds: ["a"], config: cfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    w.items.set("i1", { id: "i1", kind: "HEAL", pos: { x: 5, y: 5 } });
    resolveTick(w, [{ botId: "a", action: { type: "PICKUP" } }], cfg);
    expect(w.bots.get("a")?.inventory).toEqual(["HEAL"]);
    expect(w.items.size).toBe(0);
  });
});

describe("Protocol errors and forfeit", () => {
  test("3 protocol errors → bot forfeits remaining ticks", () => {
    const w = createWorld({ botIds: ["a"], config: cfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    for (let i = 0; i < 3; i++) {
      resolveTick(
        w,
        [{ botId: "a", action: { type: "WAIT" }, protocolError: "timeout" }],
        cfg,
      );
    }
    expect(w.bots.get("a")?.forfeited).toBe(true);
  });
});

describe("Observation (fog of war)", () => {
  test("5x5 view with self at center", () => {
    const w = createWorld({ botIds: ["a"], config: cfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    const obs = buildObservation(w, w.bots.get("a")!, cfg);
    expect(obs.view.length).toBe(5);
    expect(obs.view[0]?.length).toBe(5);
    expect(obs.self.x).toBe(5);
  });

  test("walls fill cells outside the grid", () => {
    const w = createWorld({ botIds: ["a"], config: cfg, seed: 1 });
    placeBot(w, "a", 0, 0);
    const obs = buildObservation(w, w.bots.get("a")!, cfg);
    // Top-left of view is (-2,-2) which is wall.
    expect(obs.view[0]?.[0]?.kind).toBe("wall");
  });

  test("bots and items appear in view", () => {
    const w = createWorld({ botIds: ["a", "b"], config: cfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    placeBot(w, "b", 6, 5);
    w.items.set("i1", { id: "i1", kind: "HEAL", pos: { x: 4, y: 5 } });
    const obs = buildObservation(w, w.bots.get("a")!, cfg);
    // view[2][3] = +1 right of self
    expect(obs.view[2]?.[3]?.kind).toBe("bot");
    // view[2][1] = -1 left of self
    expect(obs.view[2]?.[1]?.kind).toBe("item");
  });
});

describe("Game over and placements", () => {
  test("game over when max ticks reached", () => {
    const w = createWorld({ botIds: ["a", "b"], config: { ...cfg, maxTicks: 2 }, seed: 1 });
    expect(isGameOver(w)).toBe(false);
    resolveTick(w, [], cfg);
    resolveTick(w, [], cfg);
    expect(isGameOver(w)).toBe(true);
  });

  test("game over when only one bot alive", () => {
    const w = createWorld({ botIds: ["a", "b"], config: cfg, seed: 1 });
    w.bots.get("b")!.alive = false;
    expect(isGameOver(w)).toBe(true);
  });

  test("placements: alive > dead, then HP, then damage dealt", () => {
    const w = createWorld({ botIds: ["a", "b", "c"], config: cfg, seed: 1 });
    w.bots.get("a")!.hp = 80;
    w.bots.get("a")!.damageDealt = 50;
    w.bots.get("b")!.hp = 100;
    w.bots.get("c")!.alive = false;
    const p = placements(w);
    expect(p[0]?.botId).toBe("b"); // 100hp alive
    expect(p[1]?.botId).toBe("a"); // 80hp alive
    expect(p[2]?.botId).toBe("c"); // dead
  });
});
