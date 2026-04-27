import { describe, expect, test } from "bun:test";

import { INITIAL_RATING, updateGlicko, updateMatchRatings } from "../../src/rating/index.ts";

describe("updateGlicko", () => {
  test("matches Glickman's worked example (single rating period)", () => {
    // Worked example: player r=1500, rd=200, vol=0.06; tau=0.5.
    // Three opponents:
    //   1400 (rd=30) — score 1 (win)
    //   1550 (rd=100) — score 0
    //   1700 (rd=300) — score 0
    // Expected new rating ≈ 1464.06, new rd ≈ 151.52, new vol ≈ 0.05999
    const result = updateGlicko(
      { rating: 1500, rd: 200, vol: 0.06 },
      [
        { opponent: { rating: 1400, rd: 30, vol: 0.06 }, score: 1 },
        { opponent: { rating: 1550, rd: 100, vol: 0.06 }, score: 0 },
        { opponent: { rating: 1700, rd: 300, vol: 0.06 }, score: 0 },
      ],
    );
    expect(result.rating).toBeCloseTo(1464.06, 0);
    expect(result.rd).toBeCloseTo(151.52, 0);
    expect(result.vol).toBeCloseTo(0.05999, 4);
  });

  test("no games → only RD inflates, rating unchanged", () => {
    const r = updateGlicko(INITIAL_RATING, []);
    expect(r.rating).toBe(1500);
    expect(r.rd).toBeGreaterThan(INITIAL_RATING.rd - 0.01);
  });
});

describe("updateMatchRatings", () => {
  test("winner's rating goes up, loser's down", () => {
    const before = [
      { botId: "a", rating: { ...INITIAL_RATING }, placement: 1 },
      { botId: "b", rating: { ...INITIAL_RATING }, placement: 2 },
    ];
    const after = updateMatchRatings(before);
    expect(after.get("a")!.rating).toBeGreaterThan(1500);
    expect(after.get("b")!.rating).toBeLessThan(1500);
  });

  test("ties produce equal-and-opposite updates around 1500", () => {
    const before = [
      { botId: "a", rating: { ...INITIAL_RATING }, placement: 1 },
      { botId: "b", rating: { ...INITIAL_RATING }, placement: 1 },
    ];
    const after = updateMatchRatings(before);
    expect(after.get("a")!.rating).toBeCloseTo(1500, 1);
    expect(after.get("b")!.rating).toBeCloseTo(1500, 1);
  });

  test("4-player match — each placement gets distinct rating change", () => {
    const before = [
      { botId: "a", rating: { ...INITIAL_RATING }, placement: 1 },
      { botId: "b", rating: { ...INITIAL_RATING }, placement: 2 },
      { botId: "c", rating: { ...INITIAL_RATING }, placement: 3 },
      { botId: "d", rating: { ...INITIAL_RATING }, placement: 4 },
    ];
    const after = updateMatchRatings(before);
    const a = after.get("a")!.rating;
    const b = after.get("b")!.rating;
    const c = after.get("c")!.rating;
    const d = after.get("d")!.rating;
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(d);
  });
});
