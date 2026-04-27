export type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

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

export interface Bot {
  id: string;
  pos: Cell;
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
  /** Strikes for protocol errors (timeout/crash/malformed). 3 → forfeit. */
  strikes: number;
  forfeited: boolean;
}

export interface World {
  width: number;
  height: number;
  tick: number;
  maxTicks: number;
  bots: Map<string, Bot>;
  items: Map<string, Item>;
  /** Increments to give items unique ids. */
  itemCounter: number;
  /** Deterministic RNG seed, advances per tick. */
  rngState: number;
}

export type Action =
  | { type: "MOVE"; dir: Direction }
  | { type: "ATTACK"; dir: Direction }
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
  | "forfeited";

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
  | { kind: "bot"; botId: string; hp: number };

export interface Observation {
  tick: number;
  self: {
    x: number;
    y: number;
    hp: number;
    attack: number;
    speed: number;
    inventory: ItemKind[];
  };
  /** 5x5 grid centered on the bot. view[2][2] is always self. */
  view: ObservedCell[][];
  tickTimeMs: number;
}

export interface ItemConfig {
  heal: { hp: number };
  weapon: { attackBonus: number; rangeBonus: number };
  shield: { absorbHp: number };
  speedBoost: { ticks: number; speedBonus: number };
  spawnRatePerTick: number;
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
  tickTimeMs: number;
  items: ItemConfig;
}

export const DEFAULT_CONFIG: GameConfig = {
  width: 20,
  height: 20,
  maxTicks: 10,
  visionRadius: 2,
  startHp: 100,
  startAttack: 10,
  startSpeed: 1,
  baseAttackRange: 1,
  tickTimeMs: 300,
  items: {
    heal: { hp: 30 },
    weapon: { attackBonus: 5, rangeBonus: 1 },
    shield: { absorbHp: 20 },
    speedBoost: { ticks: 3, speedBonus: 1 },
    spawnRatePerTick: 0.3,
  },
};
