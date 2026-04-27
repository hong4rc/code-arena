export type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

/**
 * SHOOT aims at a target offset (dx, dy) from the shooter's position. Bullets
 * travel along the line from start to start+(dx,dy) using max-axis DDA — one
 * cell per step on the major axis — so a bot can fire at *any* visible cell,
 * not just the 4 cardinals. MOVE and ATTACK stay 4-way to keep collision and
 * adjacency rules simple.
 */
export interface ShootTarget {
  dx: number;
  dy: number;
}

export type ItemKind = "HEAL" | "WEAPON" | "SHIELD" | "SPEED_BOOST";

export interface Cell {
  x: number;
  y: number;
}

export interface Item {
  id: string;
  kind: ItemKind;
  pos: Cell;
}

export interface Bullet {
  id: string;
  pos: Cell;
  /** Spawn cell — stored so DDA stepping is deterministic over time. */
  start: Cell;
  /** Target offset from the shooter at fire time. Defines slope + sign. */
  vx: number;
  vy: number;
  /** Number of cells advanced from `start` along the line. */
  step: number;
  /** Bot that fired it. */
  ownerId: string;
  damage: number;
  /** Cells of travel left before despawning. Decreases as it moves. */
  remainingRange: number;
}

export interface Bot {
  id: string;
  /** Top-left corner of the bot's footprint. */
  pos: Cell;
  /** Side length of the (square) footprint, in cells. 1 = single cell. */
  size: number;
  hp: number;
  maxHp: number;
  attack: number;
  speed: number;
  inventory: ItemKind[];
  shieldHp: number;
  speedBoostTicks: number;
  damageDealt: number;
  itemsPicked: number;
  alive: boolean;
  /** Tick at which the bot died (null if still alive). Used for placements: died-later > died-earlier. */
  diedAtTick: number | null;
  /** Strikes for protocol errors (timeout/crash/malformed). 3 → forfeit. */
  strikes: number;
  forfeited: boolean;
  /** Ticks until next SHOOT is allowed. */
  shootCooldown: number;
  /** Ticks until next DASH is allowed. */
  dashCooldown: number;
}

/** PUBG-style shrinking play zone. Bots outside take damage per tick. */
export interface Zone {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface World {
  width: number;
  height: number;
  tick: number;
  maxTicks: number;
  bots: Map<string, Bot>;
  items: Map<string, Item>;
  bullets: Map<string, Bullet>;
  /** Current safe zone — bots outside take damage per tick. */
  zone: Zone;
  /** Announced next zone — randomly positioned inside `zone`. Visible to bots
   *  for `shrinkEveryTicks` ticks before it closes. null = no upcoming shrink
   *  (sudden death or pre-grace). */
  nextZone: Zone | null;
  /** Tick on which `nextZone` will become `zone`. */
  nextShrinkAtTick: number | null;
  itemCounter: number;
  bulletCounter: number;
  /** Deterministic RNG seed, advances per tick. */
  rngState: number;
}

export type Action =
  | { type: "MOVE"; dir: Direction }
  /** Sprint up to `dashRange` cells in a cardinal. Stops at first blocked cell. */
  | { type: "DASH"; dir: Direction }
  | { type: "ATTACK"; dir: Direction }
  | { type: "SHOOT"; target: ShootTarget }
  | { type: "PICKUP" }
  | { type: "USE"; item: ItemKind }
  | { type: "WAIT" };

export type ActionFailureReason =
  | "no-target-in-range"
  | "blocked-by-wall"
  | "blocked-by-bot"
  | "no-item-here"
  | "item-not-in-inventory"
  | "off-grid"
  | "dead"
  | "forfeited"
  | "shoot-on-cooldown"
  | "shoot-bad-target"
  | "dash-on-cooldown";

export interface ResolvedAction {
  botId: string;
  attempted: Action;
  applied: Action | { type: "WAIT" };
  reason?: ActionFailureReason;
  protocolError?: "timeout" | "crash" | "malformed";
}

export type ObservedCell =
  | { kind: "unknown" }
  | { kind: "empty" }
  | { kind: "wall" }
  | { kind: "item"; item: ItemKind }
  | { kind: "bot"; botId: string; hp: number }
  | { kind: "bullet"; vx: number; vy: number; ownerId: string };

export interface Observation {
  tick: number;
  self: {
    x: number;
    y: number;
    /** Footprint side length in cells. Bot occupies (x..x+size-1, y..y+size-1). */
    size: number;
    hp: number;
    attack: number;
    speed: number;
    inventory: ItemKind[];
    shootCooldown: number;
    dashCooldown: number;
  };
  /** Square grid centered on the bot, side = 2*visionRadius+1. view[r][r] is self. */
  view: ObservedCell[][];
  /** Current safe zone — bots outside take damage every tick. */
  zone: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
    /** The pre-announced next safe zone (null if none coming). Random subzone of `zone`. */
    nextZone: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
    /** Ticks until the next zone closes in. null if no shrink scheduled. */
    ticksUntilShrink: number | null;
  };
  /**
   * Every bot in the match (incl. self), with current liveness. Lets bots
   * count survivors and react to kills they didn't witness directly.
   */
  roster: { id: string; alive: boolean }[];
  tickTimeMs: number;
}

export interface ItemConfig {
  heal: { hp: number };
  weapon: { attackBonus: number; rangeBonus: number };
  shield: { absorbHp: number };
  speedBoost: { ticks: number; speedBonus: number };
  /** Probability of an item-spawn attempt per tick (0..1). */
  spawnRatePerTick: number;
  /** Hard cap on items present on the map. New items don't spawn until one is picked up. */
  maxItems: number;
}

export interface BulletConfig {
  /** Cells the bullet advances per tick. */
  speed: number;
  /** Total cells it can travel before despawning. */
  maxRange: number;
  damage: number;
  /** Ticks the shooter must wait before SHOOTing again. */
  cooldownTicks: number;
}

export interface ZoneConfig {
  /** Shrink the zone every this many ticks. */
  shrinkEveryTicks: number;
  /** How many cells to pull each side toward the center each shrink. */
  shrinkAmount: number;
  /** HP damage per tick to bots standing outside the zone. */
  damagePerTickOutside: number;
  /** Don't start shrinking until this tick (gives bots time to gear up). */
  graceTicks: number;
  /**
   * Sudden death: from this tick onwards the zone collapses entirely (no safe
   * cells), so every bot takes `damagePerTickOutside` per tick. Forces a
   * decisive end even if bots stalemate. 0 disables sudden death.
   */
  suddenDeathTick: number;
}

export interface GameConfig {
  width: number;
  height: number;
  maxTicks: number;
  visionRadius: number;
  startHp: number;
  startAttack: number;
  startSpeed: number;
  baseAttackRange: number;
  /** Side length of the bot's square footprint in cells. */
  botSize: number;
  tickTimeMs: number;
  items: ItemConfig;
  bullets: BulletConfig;
  zone: ZoneConfig;
  /** Max cells a DASH can cover in one tick. */
  dashRange: number;
  /** Ticks the dasher must wait before DASHing again. */
  dashCooldownTicks: number;
}

// Targeted real-time profile:
//   - 10 ticks per second (tickTimeMs = 100)
//   - ~90 second match cap (maxTicks = 900)
// All timing-related values are scaled to that base.
export const DEFAULT_CONFIG: GameConfig = {
  // 100×100 grid = 10 000 cells — feels like a small island map.
  // Bots are 2×2 each (4 cells); 10 bots take ~40 cells = 0.4% of the map.
  width: 100,
  height: 100,
  maxTicks: 900,
  visionRadius: 7,            // 15×15 view — needed so bots find each other on a big map
  startHp: 100,
  startAttack: 8,             // melee base — weaker than bullets so SHOOT > ATTACK
  startSpeed: 1,
  baseAttackRange: 1,
  botSize: 2,
  tickTimeMs: 100,            // 10 fps — bot has 100 ms wall time per turn
  items: {
    heal: { hp: 30 },
    weapon: { attackBonus: 5, rangeBonus: 1 },
    shield: { absorbHp: 20 },
    speedBoost: { ticks: 30, speedBonus: 1 },
    spawnRatePerTick: 0.5,    // up to ~5 items/sec on average …
    maxItems: 40,             // … but cap the map at 40 items at any one time.
                              // (Items only respawn after one is picked up.)
  },
  bullets: {
    speed: 5,                 // 5 cells/tick (= 50 cells/sec)
    maxRange: 35,             // ~7 ticks of flight = 0.7 s
    damage: 18,               // > melee (8 base, 13 with weapon) — ranged is the rewarded play
    cooldownTicks: 5,         // 0.5 s cooldown between shots
  },
  dashRange: 4,               // 4 cells in one tick (4× normal MOVE)
  dashCooldownTicks: 8,       // 0.8 s cooldown between dashes
  zone: {
    graceTicks: 100,           // 10 s of free roam
    shrinkEveryTicks: 60,      // every 6 s the zone closes in
    shrinkAmount: 6,           // 6 cells from each side per shrink
    damagePerTickOutside: 1,   // 10 HP/sec outside
    suddenDeathTick: 750,      // last 15 s of the 90 s match: zone collapses
  },
};
