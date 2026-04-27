import { randomBytes } from "node:crypto";

/**
 * Generate a UUIDv7 string. Layout (RFC 9562):
 *   48 bits unix-time-ms | 4 bits version (0b0111) | 12 bits rand_a
 *   2 bits variant (0b10) | 62 bits rand_b
 *
 * Time-sortable, no collision risk in practice.
 */
export function uuidv7(): string {
  const ms = BigInt(Date.now());
  const rnd = randomBytes(10); // 10 random bytes (we'll overwrite the variant bits)

  const bytes = new Uint8Array(16);
  // 48-bit timestamp
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  // 16 bits: 4-bit version (7) + 12 random
  bytes[6] = (0x70 | (rnd[0]! & 0x0f)) & 0xff;
  bytes[7] = rnd[1]!;
  // 64 bits: 2-bit variant (10) + 62 random
  bytes[8] = (0x80 | (rnd[2]! & 0x3f)) & 0xff;
  bytes[9] = rnd[3]!;
  bytes[10] = rnd[4]!;
  bytes[11] = rnd[5]!;
  bytes[12] = rnd[6]!;
  bytes[13] = rnd[7]!;
  bytes[14] = rnd[8]!;
  bytes[15] = rnd[9]!;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
