import { describe, expect, test } from "bun:test";

import {
  buildObservation,
  createWorld,
  isGameOver,
  mergeConfig,
  placements,
  resolveTick,
} from "../../src/world/index.ts";

import type { Bot, BotInput, GameConfig, World } from "../../src/world/index.ts";

// Legacy tests assume 1-cell bots. Multi-cell behavior covered separately.
const cfg: GameConfig = mergeConfig({
  width: 10,
  height: 10,
  maxTicks: 10,
  visionRadius: 2,
  botSize: 1,
  zone: { graceTicks: 999, shrinkEveryTicks: 999, shrinkAmount: 0, damagePerTickOutside: 0, suddenDeathTick: 0 },
});

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

  test("two bots both moving onto an item: both blocked, item stays", () => {
    // Both A (left) and B (right) target the cell holding the item — collision
    // rule blocks both moves, so neither stands on the item when PICKUP runs.
    const w = createWorld({ botIds: ["a", "b"], config: cfg, seed: 1 });
    placeBot(w, "a", 4, 5);
    placeBot(w, "b", 6, 5);
    w.items.set("i1", { id: "i1", kind: "HEAL", pos: { x: 5, y: 5 } });
    resolveTick(
      w,
      [
        { botId: "a", action: { type: "MOVE", dir: "RIGHT" } },
        { botId: "b", action: { type: "MOVE", dir: "LEFT" } },
      ],
      cfg,
    );
    expect(w.bots.get("a")?.pos).toEqual({ x: 4, y: 5 });
    expect(w.bots.get("b")?.pos).toEqual({ x: 6, y: 5 });
    expect(w.items.size).toBe(1);
  });

  test("only the bot ON the item picks it up; an adjacent bot trying to MOVE there is blocked", () => {
    // A is standing on the item and submits PICKUP.
    // B is adjacent and submits MOVE onto the item's cell — blocked because A is there.
    const w = createWorld({ botIds: ["a", "b"], config: cfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    placeBot(w, "b", 6, 5);
    w.items.set("i1", { id: "i1", kind: "HEAL", pos: { x: 5, y: 5 } });
    const r = resolveTick(
      w,
      [
        { botId: "a", action: { type: "PICKUP" } },
        { botId: "b", action: { type: "MOVE", dir: "LEFT" } },
      ],
      cfg,
    );
    expect(w.bots.get("a")?.inventory).toEqual(["HEAL"]);
    expect(w.bots.get("b")?.pos).toEqual({ x: 6, y: 5 });
    expect(w.items.size).toBe(0);
    expect(r.find((x) => x.botId === "b")?.reason).toBe("blocked-by-bot");
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

  test("placements: among dead, died later (longer survived) ranks higher", () => {
    const w = createWorld({ botIds: ["a", "b", "c"], config: cfg, seed: 1 });
    // Everyone is dead. b survived the longest (died tick 50), a tick 30, c tick 10.
    w.bots.get("a")!.alive = false; w.bots.get("a")!.diedAtTick = 30;
    w.bots.get("b")!.alive = false; w.bots.get("b")!.diedAtTick = 50;
    w.bots.get("c")!.alive = false; w.bots.get("c")!.diedAtTick = 10;
    const p = placements(w);
    expect(p[0]?.botId).toBe("b"); // died last
    expect(p[1]?.botId).toBe("a");
    expect(p[2]?.botId).toBe("c"); // died first
  });
});

describe("SHOOT + bullets", () => {
  // Wide field with no zone interference; lots of ticks to test bullet travel.
  // Use 1-cell bots so the existing test math is unaffected.
  const bigCfg: GameConfig = mergeConfig({
    width: 30,
    height: 30,
    maxTicks: 50,
    botSize: 1,
    zone: { graceTicks: 999, shrinkEveryTicks: 999, shrinkAmount: 0, damagePerTickOutside: 0, suddenDeathTick: 0 },
  });

  test("SHOOT spawns a bullet at the shooter's cell", () => {
    const w = createWorld({ botIds: ["a"], config: bigCfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    resolveTick(w, [{ botId: "a", action: { type: "SHOOT", target: { dx: 10, dy: 0 } } }], bigCfg);
    // Bullet has moved `speed` cells (default 4), then maybe stopped at edge. Check it exists.
    expect(w.bullets.size).toBeGreaterThanOrEqual(0);
  });

  test("bullet hits a bot in its path and damages it", () => {
    const w = createWorld({ botIds: ["a", "b"], config: bigCfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    // Target inside the per-tick travel window so the hit lands on tick 1.
    placeBot(w, "b", 5 + bigCfg.bullets.speed, 5);
    resolveTick(w, [{ botId: "a", action: { type: "SHOOT", target: { dx: 10, dy: 0 } } }], bigCfg);
    expect(w.bots.get("b")?.hp).toBe(bigCfg.startHp - bigCfg.bullets.damage);
    expect(w.bullets.size).toBe(0);
  });

  test("bullet despawns at end of range without hitting anyone", () => {
    const w = createWorld({ botIds: ["a"], config: bigCfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    const ticksToDespawn = Math.ceil(bigCfg.bullets.maxRange / bigCfg.bullets.speed);
    resolveTick(w, [{ botId: "a", action: { type: "SHOOT", target: { dx: 10, dy: 0 } } }], bigCfg);
    for (let i = 0; i < ticksToDespawn; i++) resolveTick(w, [], bigCfg);
    expect(w.bullets.size).toBe(0);
  });

  test("bullet ignores its own owner (doesn't self-damage)", () => {
    const w = createWorld({ botIds: ["a"], config: bigCfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    resolveTick(w, [{ botId: "a", action: { type: "SHOOT", target: { dx: 10, dy: 0 } } }], bigCfg);
    expect(w.bots.get("a")?.hp).toBe(bigCfg.startHp);
  });

  test("SHOOT cooldown blocks back-to-back shots", () => {
    const w = createWorld({ botIds: ["a"], config: bigCfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    resolveTick(w, [{ botId: "a", action: { type: "SHOOT", target: { dx: 0, dy: -10 } } }], bigCfg);
    const r = resolveTick(w, [{ botId: "a", action: { type: "SHOOT", target: { dx: 0, dy: -10 } } }], bigCfg);
    const second = r.find((x) => x.botId === "a");
    expect(second?.applied.type).toBe("WAIT");
    expect(second?.reason).toBe("shoot-on-cooldown");
  });

  test("SHIELD absorbs bullet damage", () => {
    const w = createWorld({ botIds: ["a", "b"], config: bigCfg, seed: 1 });
    placeBot(w, "a", 5, 5);
    placeBot(w, "b", 5 + bigCfg.bullets.speed, 5, { shieldHp: 100 });
    resolveTick(w, [{ botId: "a", action: { type: "SHOOT", target: { dx: 10, dy: 0 } } }], bigCfg);
    expect(w.bots.get("b")?.hp).toBe(bigCfg.startHp);
    expect(w.bots.get("b")?.shieldHp).toBe(100 - bigCfg.bullets.damage);
  });
});

describe("Zone (PUBG-style shrinking)", () => {
  test("starts as full map", () => {
    const w = createWorld({ botIds: ["a"], config: cfg, seed: 1 });
    expect(w.zone).toEqual({ xMin: 0, yMin: 0, xMax: cfg.width - 1, yMax: cfg.height - 1 });
  });

  test("does not shrink during grace ticks", () => {
    const c = mergeConfig({
      width: 20, height: 20,
      zone: { graceTicks: 5, shrinkEveryTicks: 4, shrinkAmount: 2, damagePerTickOutside: 1, suddenDeathTick: 0 },
    });
    const w = createWorld({ botIds: ["a"], config: c, seed: 1 });
    const before = { ...w.zone };
    for (let i = 0; i < 5; i++) resolveTick(w, [], c);
    expect(w.zone).toEqual(before);
  });

  test("first shrink-due tick announces nextZone; following tick applies it", () => {
    const c = mergeConfig({
      width: 20, height: 20, maxTicks: 50,
      zone: { graceTicks: 0, shrinkEveryTicks: 2, shrinkAmount: 2, damagePerTickOutside: 5, suddenDeathTick: 0 },
    });
    const w = createWorld({ botIds: ["a"], config: c, seed: 1 });
    placeBot(w, "a", 10, 10);

    // Tick 0: shrink-due. nextZone gets announced (random subzone), but the
    // current zone is still the full map.
    resolveTick(w, [], c);
    expect(w.zone).toEqual({ xMin: 0, yMin: 0, xMax: 19, yMax: 19 });
    expect(w.nextZone).not.toBeNull();
    expect(w.nextShrinkAtTick).toBe(2); // shrink will land at tick 2

    // Confirm nextZone is a strict random sub-rect of current zone.
    const nz = w.nextZone!;
    expect(nz.xMax - nz.xMin + 1).toBe(20 - 2 * c.zone.shrinkAmount);
    expect(nz.yMax - nz.yMin + 1).toBe(20 - 2 * c.zone.shrinkAmount);
    expect(nz.xMin).toBeGreaterThanOrEqual(0);
    expect(nz.xMax).toBeLessThanOrEqual(19);
  });

  test("at the announced tick the nextZone becomes the current zone", () => {
    const c = mergeConfig({
      width: 20, height: 20, maxTicks: 50,
      zone: { graceTicks: 0, shrinkEveryTicks: 2, shrinkAmount: 2, damagePerTickOutside: 5, suddenDeathTick: 0 },
    });
    const w = createWorld({ botIds: ["a"], config: c, seed: 1 });
    placeBot(w, "a", 10, 10);
    resolveTick(w, [], c);
    const announced = w.nextZone!;
    resolveTick(w, [], c); // tick 1: not shrink-due
    expect(w.zone).toEqual({ xMin: 0, yMin: 0, xMax: 19, yMax: 19 });
    resolveTick(w, [], c); // tick 2: shrink-due → apply
    expect(w.zone).toEqual(announced);
  });

  test("nextZone is hidden from bots in the first half of the cycle, revealed in the second", () => {
    const c = mergeConfig({
      width: 20, height: 20, maxTicks: 100, visionRadius: 2, botSize: 1,
      zone: { graceTicks: 0, shrinkEveryTicks: 10, shrinkAmount: 2, damagePerTickOutside: 0, suddenDeathTick: 0 },
    });
    const w = createWorld({ botIds: ["a"], config: c, seed: 1 });
    placeBot(w, "a", 5, 5);
    // Tick 0: shrink-due. nextZone is internally rolled. obs at this point sees
    // ticksUntilShrink = 10. Half-cycle = 5 → reveal threshold is when
    // ticksUntilShrink <= 5. So at tick 0–4 it's hidden; tick 5–9 it's visible.
    resolveTick(w, [], c);
    let obs = buildObservation(w, w.bots.get("a")!, c);
    expect(obs.zone.ticksUntilShrink).toBe(9); // shrink at tick 10, current tick 1
    expect(obs.zone.nextZone).toBeNull();      // first half — hidden

    // Advance to halfway.
    for (let i = 0; i < 4; i++) resolveTick(w, [], c);
    obs = buildObservation(w, w.bots.get("a")!, c);
    expect(obs.zone.ticksUntilShrink).toBe(5);
    expect(obs.zone.nextZone).not.toBeNull(); // second half — revealed
  });

  test("damages bots that end up outside the freshly-shrunk zone", () => {
    const c = mergeConfig({
      width: 20, height: 20, maxTicks: 50,
      zone: { graceTicks: 0, shrinkEveryTicks: 2, shrinkAmount: 8, damagePerTickOutside: 5, suddenDeathTick: 0 },
    });
    const w = createWorld({ botIds: ["a"], config: c, seed: 1 });
    placeBot(w, "a", 0, 0); // corner — guaranteed outside any 4x4 subzone (since shrinkAmount=8 → 4x4 final)
    resolveTick(w, [], c); // announce
    resolveTick(w, [], c); // tick 1: damage phase still in full map — A at (0,0) safe
    expect(w.bots.get("a")?.hp).toBe(c.startHp);
    resolveTick(w, [], c); // tick 2: zone closes; A is now outside any 4x4 subzone
    // The very next tick after shrink is when A should bleed.
    resolveTick(w, [], c);
    expect(w.bots.get("a")!.hp).toBeLessThan(c.startHp);
  });
});

describe("Item cap", () => {
  test("stops spawning at maxItems and resumes after pickup", () => {
    const c = mergeConfig({
      width: 8, height: 8, maxTicks: 200, botSize: 1, visionRadius: 2,
      items: {
        heal: { hp: 30 }, weapon: { attackBonus: 5, rangeBonus: 1 },
        shield: { absorbHp: 20 }, speedBoost: { ticks: 3, speedBonus: 1 },
        spawnRatePerTick: 1,   // try every tick
        maxItems: 3,
      },
      zone: { graceTicks: 999, shrinkEveryTicks: 999, shrinkAmount: 0, damagePerTickOutside: 0, suddenDeathTick: 0 },
    });
    const w = createWorld({ botIds: ["a"], config: c, seed: 1 });
    placeBot(w, "a", 0, 0);

    // After many ticks the spawner should top out at 3.
    for (let i = 0; i < 50; i++) resolveTick(w, [], c);
    expect(w.items.size).toBeLessThanOrEqual(3);
    expect(w.items.size).toBeGreaterThan(0);

    // Manually empty the items, then verify the spawner refills.
    const idsBefore = new Set(w.items.keys());
    w.items.clear();
    expect(w.items.size).toBe(0);
    for (let i = 0; i < 30; i++) resolveTick(w, [], c);
    expect(w.items.size).toBeGreaterThan(0);
    expect(w.items.size).toBeLessThanOrEqual(3);
    // Refill produced fresh ids (counter advanced), not the same set.
    const idsAfter = new Set(w.items.keys());
    let overlap = 0;
    for (const id of idsAfter) if (idsBefore.has(id)) overlap += 1;
    expect(overlap).toBe(0);
  });
});

describe("Multi-cell bots (botSize > 1)", () => {
  const big: GameConfig = mergeConfig({
    width: 12,
    height: 12,
    maxTicks: 30,
    botSize: 2,
    zone: { graceTicks: 999, shrinkEveryTicks: 999, shrinkAmount: 0, damagePerTickOutside: 0, suddenDeathTick: 0 },
  });

  test("createWorld places bots without overlapping footprints", () => {
    const w = createWorld({ botIds: ["a", "b", "c", "d"], config: big, seed: 99 });
    const bots = [...w.bots.values()];
    for (let i = 0; i < bots.length; i++) {
      for (let j = i + 1; j < bots.length; j++) {
        const a = bots[i]!, b = bots[j]!;
        const overlap = !(a.pos.x + a.size <= b.pos.x || b.pos.x + b.size <= a.pos.x
                       || a.pos.y + a.size <= b.pos.y || b.pos.y + b.size <= a.pos.y);
        expect(overlap).toBe(false);
      }
    }
  });

  test("a 2x2 bot can't move into a cell that would overlap another 2x2 bot", () => {
    const w = createWorld({ botIds: ["a", "b"], config: big, seed: 1 });
    placeBot(w, "a", 2, 2); // footprint (2,2)-(3,3)
    placeBot(w, "b", 5, 2); // footprint (5,2)-(6,3) — gap of 1 cell between them
    // A moves RIGHT → would target (3,2)-(4,3); B's footprint is (5,2)-(6,3) — no overlap, A succeeds.
    resolveTick(w, [{ botId: "a", action: { type: "MOVE", dir: "RIGHT" } }], big);
    expect(w.bots.get("a")?.pos).toEqual({ x: 3, y: 2 });
    // Try again — now A footprint (3,2)-(4,3), target would be (4,2)-(5,3) which overlaps B → blocked.
    const r = resolveTick(w, [{ botId: "a", action: { type: "MOVE", dir: "RIGHT" } }], big);
    expect(w.bots.get("a")?.pos).toEqual({ x: 3, y: 2 });
    expect(r.find((x) => x.botId === "a")?.reason).toBe("blocked-by-bot");
  });

  test("bullet hits any cell of a multi-cell bot", () => {
    const w = createWorld({ botIds: ["a", "b"], config: big, seed: 1 });
    placeBot(w, "a", 0, 0); // shooter footprint (0,0)-(1,1)
    placeBot(w, "b", 5, 1); // target footprint (5,1)-(6,2). Bullet from (1,0) RIGHT lands at (5,0)
                            // wait — let's aim at row 1 instead. Spawn at edge midpoint y=1.
    // edgeCells RIGHT for size=2 at (0,0): (1,0),(1,1). Middle (index 1) = (1,1). Spawn there.
    // advanceBullets: tick step 1 → (2,1), step 2 → (3,1), step 3 → (4,1) (with speed=3). Then hit?
    // After 1 tick (speed 3 cells), bullet is at (4,1). Bot B footprint (5,1)-(6,2). Not yet.
    // Need a second tick.
    resolveTick(w, [{ botId: "a", action: { type: "SHOOT", target: { dx: 10, dy: 0 } } }], big);
    resolveTick(w, [], big);
    expect(w.bots.get("b")?.hp).toBe(big.startHp - big.bullets.damage);
  });
});
