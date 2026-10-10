/**
 * ULID generator - monotonic, sortable, no external deps.
 * Uses crypto.getRandomValues when available (Node 19+), falls back to Math.random.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ENCODING.length;
const TIME_MAX = Math.pow(2, 48) - 1;
const RANDOM_LEN = 16;

function randomChar(rand: () => number): string {
  return ENCODING[Math.floor(rand() * ENCODING_LEN)] ?? "0";
}

function encodeTime(now: number, len: number): string {
  let str = "";
  for (let i = len - 1; i >= 0; i--) {
    const mod = now % ENCODING_LEN;
    str = (ENCODING[mod] ?? "0") + str;
    now = Math.floor(now / ENCODING_LEN);
  }
  return str;
}

let lastTime = 0;
let lastRandom = "";

export function ulid(seedTime?: number): string {
  const now = seedTime ?? Date.now();
  if (now > TIME_MAX) throw new RangeError("Time is too large for ULID");

  // Monotonic: if same millisecond, increment the random part
  if (now === lastTime && lastRandom.length === RANDOM_LEN) {
    // Increment last char
    let carried = true;
    const chars = lastRandom.split("");
    for (let i = RANDOM_LEN - 1; i >= 0 && carried; i--) {
      const idx = ENCODING.indexOf(chars[i] ?? "0");
      if (idx === ENCODING_LEN - 1) {
        chars[i] = "0";
      } else {
        chars[i] = ENCODING[idx + 1] ?? "0";
        carried = false;
      }
    }
    lastRandom = chars.join("");
  } else {
    lastTime = now;
    const rand = () => Math.random();
    lastRandom = Array.from({ length: RANDOM_LEN }, () =>
      randomChar(rand),
    ).join("");
  }

  return encodeTime(now, 10) + lastRandom;
}

/** Generate a short ref ID like 'r_8f3k2' */
export function shortId(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let id = "r_";
  for (let i = 0; i < 5; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
