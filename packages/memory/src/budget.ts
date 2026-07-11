/**
 * Token accounting for the working-tier slice. The min-slice budget is a HARD cap
 * (architecture.md §6: "assembled under a token budget"): retrieval assembles the
 * highest-scoring facts until the next one would exceed the budget, then stops.
 * The estimate is deliberately conservative (rounds UP) so the real slice can only
 * ever be smaller than what we counted — never larger than the budget.
 */

/** Conservative, deterministic token estimate (~4 chars/token, rounded up). */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
