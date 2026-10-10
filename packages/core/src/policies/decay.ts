/**
 * Time decay and effective importance scoring.
 *
 * effectiveImportance = base * decay(age) * accessBoost * pinnedBoost
 *
 * decay(age) = 0.5^(age_days / halfLifeDays)  - exponential decay
 * accessBoost: log-scale boost for frequently accessed memories
 * pinnedBoost: pinned memories never decay below 0.3
 */

export interface DecayOptions {
  halfLifeDays: number; // default 30
}

const MS_PER_DAY = 86_400_000;

export function effectiveImportance(
  importance: number,
  lastAccessedAt: number,
  accessCount: number,
  pinned: boolean,
  now: number,
  opts: DecayOptions,
): number {
  const ageDays = (now - lastAccessedAt) / MS_PER_DAY;
  const decay = Math.pow(0.5, ageDays / opts.halfLifeDays);

  // Access boost: up to +0.2 for frequently accessed memories (log scale)
  const accessBoost = Math.min(0.2, Math.log10(accessCount + 1) * 0.1);

  let score = importance * decay + accessBoost;

  // Pinned items don't decay below 0.3
  if (pinned) score = Math.max(score, 0.3);

  return Math.min(1.0, score);
}

/**
 * Score for ranking in recall results.
 * Blends FTS BM25 rank, effective importance, recency, and pinned boost.
 *
 * @param bm25Rank - negative number from FTS5 (more negative = better match)
 * @param effectiveImp - 0..1 from effectiveImportance()
 * @param pinned - true if pinned
 */
export function recallScore(
  bm25Rank: number,
  effectiveImp: number,
  pinned: boolean,
): number {
  // Normalize bm25 to 0..1 (rank is negative; more negative = better match)
  const normalizedBm25 = Math.max(0, Math.min(1, Math.abs(bm25Rank) / 10));

  const weights = { bm25: 0.5, importance: 0.3, pinned: 0.2 };
  return (
    weights.bm25 * normalizedBm25 +
    weights.importance * effectiveImp +
    weights.pinned * (pinned ? 1 : 0)
  );
}
