/** Mulberry32 — small, deterministic PRNG. Same seed → same sequence. */
export function rngNext(state: number): { state: number; value: number } {
  // `| 0` is intentional — it forces 32-bit signed integer truncation, which
  // Math.trunc does NOT do for values > 2^31. Required for Mulberry32.
  // eslint-disable-next-line unicorn/prefer-math-trunc
  let s = (state + 0x6D_2B_79_F5) | 0;
  const next = s;
  s = Math.imul(s ^ (s >>> 15), s | 1);
  s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
  const value = ((s ^ (s >>> 14)) >>> 0) / 4_294_967_296;
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
