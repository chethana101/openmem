import { describe, expect, it } from "vitest";
import { effectiveImportance, recallScore } from "../src/policies/decay.js";

describe("decay policy", () => {
  const MS_PER_DAY = 86_400_000;

  it("applies exponential decay with half-life", () => {
    const now = Date.now();
    const halfLifeDays = 30;

    // Fresh memory (0 days old)
    const fresh = effectiveImportance(1.0, now, 0, false, now, { halfLifeDays });
    expect(fresh).toBeCloseTo(1.0, 2);

    // 30 days old (one half life)
    const thirtyDays = effectiveImportance(1.0, now - 30 * MS_PER_DAY, 0, false, now, {
      halfLifeDays,
    });
    expect(thirtyDays).toBeCloseTo(0.5, 2);

    // 60 days old (two half lives)
    const sixtyDays = effectiveImportance(1.0, now - 60 * MS_PER_DAY, 0, false, now, {
      halfLifeDays,
    });
    expect(sixtyDays).toBeCloseTo(0.25, 2);
  });

  it("boosts frequently accessed memories", () => {
    const now = Date.now();
    const age = now - 10 * MS_PER_DAY;

    const noAccess = effectiveImportance(0.5, age, 0, false, now, { halfLifeDays: 30 });
    const accessedTenTimes = effectiveImportance(0.5, age, 10, false, now, { halfLifeDays: 30 });

    expect(accessedTenTimes).toBeGreaterThan(noAccess);
  });

  it("prevents pinned memories from decaying below 0.3", () => {
    const now = Date.now();
    const veryOld = now - 365 * MS_PER_DAY; // 1 year old

    const unpinned = effectiveImportance(0.8, veryOld, 0, false, now, { halfLifeDays: 30 });
    const pinned = effectiveImportance(0.8, veryOld, 0, true, now, { halfLifeDays: 30 });

    expect(unpinned).toBeLessThan(0.1);
    expect(pinned).toBeGreaterThanOrEqual(0.3);
  });

  it("computes hybrid recallScore blending BM25, importance, and pin", () => {
    // Exact keyword match (-10 rank), high importance, pinned
    const topScore = recallScore(-10, 0.9, true);

    // Lower keyword match (-2 rank), low importance, unpinned
    const lowScore = recallScore(-2, 0.3, false);

    expect(topScore).toBeGreaterThan(lowScore);
  });
});
