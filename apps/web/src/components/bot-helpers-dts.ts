// Type definitions for the helper globals injected by the bot harness.
// Loaded into Monaco via `addExtraLib(...)` so authors get autocomplete + hover docs.
//
// Keep in sync with `bots/runtime/harness.js` and `docs/HELPERS.md`.
export const BOT_HELPERS_DTS = String.raw`
type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";
type ItemKind = "HEAL" | "WEAPON" | "SHIELD" | "SPEED_BOOST";
interface ShootTarget { dx: number; dy: number; }

interface ObservedCell {
  kind: "empty" | "wall" | "item" | "bot" | "bullet" | "unknown";
  item?: ItemKind;
  botId?: string;
  hp?: number;
  vx?: number;
  vy?: number;
  ownerId?: string;
}
interface Observation {
  tick: number;
  self: {
    x: number; y: number; size: number;
    hp: number; attack: number; speed: number;
    inventory: ItemKind[];
    shootCooldown: number;
    dashCooldown: number;
  };
  view: ObservedCell[][];
  zone: {
    xMin: number; yMin: number; xMax: number; yMax: number;
    nextZone: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
    ticksUntilShrink: number | null;
  };
  roster: { id: string; alive: boolean }[];
  tickTimeMs: number;
}

type Action =
  | { type: "MOVE"; dir: Direction }
  | { type: "DASH"; dir: Direction }
  | { type: "ATTACK"; dir: Direction }
  | { type: "SHOOT"; target: ShootTarget }
  | { type: "PICKUP" }
  | { type: "USE"; item: ItemKind }
  | { type: "WAIT" };

// ─── Constants ─────────────────────────────────────────────────────
declare const DIRS: Direction[];

// ─── View / observation helpers ───────────────────────────────────
declare function adjacent(obs: Observation, dir: Direction): ObservedCell | undefined;
declare function here(obs: Observation): ObservedCell | undefined;
declare function nearest<T extends ObservedCell>(obs: Observation, predicate: (c: ObservedCell) => boolean): { dx: number; dy: number; dist: number } & T | null;
declare function nearestBot(obs: Observation): { dx: number; dy: number; dist: number; botId: string; hp: number } | null;
declare function nearestItem(obs: Observation, kind?: ItemKind): { dx: number; dy: number; dist: number; item: ItemKind } | null;
declare function visibleBots(obs: Observation): Array<{ dx: number; dy: number; dist: number; botId: string; hp: number }>;
declare function visibleItems(obs: Observation, kind?: ItemKind): Array<{ dx: number; dy: number; dist: number; item: ItemKind }>;
declare function visibleBullets(obs: Observation): Array<{ dx: number; dy: number; dist: number; vx: number; vy: number; ownerId: string }>;
declare function adjacentBots(obs: Observation): Array<{ dir: Direction; dx: number; dy: number; hp: number; botId: string }>;
declare function adjacentItems(obs: Observation): Array<{ dir: Direction; dx: number; dy: number; item: ItemKind }>;

// ─── Direction / movement helpers ─────────────────────────────────
declare function dirTo(dx: number, dy: number): Direction;
declare function dirAlign(dx: number, dy: number): Direction;
declare function fleeFrom(dx: number, dy: number): Direction;
declare function opposite(dir: Direction): Direction;
declare function dist(dx: number, dy: number): number;
declare function pickRandom<T>(arr: T[]): T;
declare function turn(dir: Direction, n: number): Direction;
declare function smartMove(obs: Observation, preferredDir: Direction): Direction | null;
declare function safestDir(obs: Observation): Direction;

// ─── Predicates ───────────────────────────────────────────────────
declare function canMove(obs: Observation, dir: Direction): boolean;
declare function canAttack(obs: Observation, dir: Direction): boolean;
declare function canKill(obs: Observation, dir: Direction): boolean;
declare function canPickup(obs: Observation): boolean;
declare function canShoot(obs: Observation): boolean;
declare function canDash(obs: Observation): boolean;
declare function hasItem(obs: Observation, kind: ItemKind): boolean;
declare function hpFraction(obs: Observation, maxHp?: number): number;
declare function lowHp(obs: Observation, threshold?: number): boolean;

// ─── Combat helpers ───────────────────────────────────────────────
declare function attackRange(obs: Observation): number;
declare function bestAttackDir(obs: Observation): Direction | null;
declare function bestShootTarget(obs: Observation): ShootTarget | null;
/** @deprecated alias for bestShootTarget — old bots may still use this */
declare function bestShootDir(obs: Observation): ShootTarget | null;
declare function bestDashDir(obs: Observation): Direction | null;
declare function scanLine(obs: Observation, dir: Direction): ObservedCell[];

// ─── Bullet helpers ───────────────────────────────────────────────
declare function incomingBullets(obs: Observation): Array<{ dx: number; dy: number; dist: number; vx: number; vy: number; ownerId: string }>;

// ─── Zone helpers ─────────────────────────────────────────────────
declare function inZone(obs: Observation): boolean;
declare function dirToZone(obs: Observation): Direction | null;
declare function inNextZone(obs: Observation): boolean;
declare function dirToNextZone(obs: Observation): Direction | null;
declare function ticksUntilShrink(obs: Observation): number | null;

// ─── Roster (cross-bot info) ──────────────────────────────────────
declare function aliveCount(obs: Observation): number;
declare function isEndgame(obs: Observation): boolean;

// ─── Memory / prediction ──────────────────────────────────────────
declare function trackEnemies(obs: Observation, state: any): Record<string, { vx: number; vy: number }>;
declare function leadShot(
  obs: Observation,
  enemy: { dx: number; dy: number; botId: string },
  vel?: { vx: number; vy: number },
  opts?: { bulletSpeed?: number },
): ShootTarget;

// ─── Misc ─────────────────────────────────────────────────────────
declare function log(msg: string): void;
`;
