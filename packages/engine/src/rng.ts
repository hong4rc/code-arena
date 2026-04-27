/** Mulberry32 — small, deterministic PRNG. Same seed → same sequence. */
export function rngNext(state: number): { state: number; value: number } {
  let s = (state + 0x6d2b79f5) | 0;
  const next = s;
  s = Math.imul(s ^ (s >>> 15), s | 1);
  s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
  const value = ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  return { state: next, value };
}

export function rngInt(state: number, max: number): { state: number; value: number } {
  const r = rngNext(state);
  return { state: r.state, value: Math.floor(r.value * max) };
}

export function rngPick<T>(state: number, arr: readonly T[]): { state: number; value: T } {
  if (arr.length === 0) throw new Error("rngPick: empty array");
  const r = rngInt(state, arr.length);
  return { state: r.state, value: arr[r.value] as T };
}
