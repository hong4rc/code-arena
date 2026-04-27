import { describe, expect, test } from "bun:test";

import { uuidv7 } from "../src/uuidv7.ts";

describe("uuidv7", () => {
  test("matches the canonical 8-4-4-4-12 hex layout", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("version nibble is 7 and variant is 10xx", () => {
    const id = uuidv7();
    expect(id.charAt(14)).toBe("7");              // version 7
    expect("89ab").toContain(id.charAt(19));       // variant 10xx → 8/9/a/b
  });

  test("ids generated within the same ms still increase or stay equal", () => {
    const a = uuidv7();
    const b = uuidv7();
    expect(a.localeCompare(b)).toBeLessThanOrEqual(0);
  });

  test("ids generated 5ms apart are strictly ordered", async () => {
    const a = uuidv7();
    await new Promise((r) => setTimeout(r, 5));
    const b = uuidv7();
    expect(a.localeCompare(b)).toBeLessThan(0);
  });

  test("100k generations are unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) seen.add(uuidv7());
    expect(seen.size).toBe(100_000);
  });
});
