// Sørensen–Dice coefficient over character bigrams — used to suggest ERP
// master-data matches when sheet names have minor spelling/punctuation drift
// (e.g. "Brightway Pharma" vs "Brightway Pharma Pvt Ltd"). More robust to
// word reordering than plain Levenshtein edit distance, and cheap enough to
// run over a full doctype's records client-side.

function bigrams(s: string): string[] {
  const clean = s.trim().toLowerCase().replace(/\s+/g, ' ')
  if (clean.length < 2) return [clean]
  const out: string[] = []
  for (let i = 0; i < clean.length - 1; i++) out.push(clean.slice(i, i + 2))
  return out
}

export function diceCoefficient(a: string, b: string): number {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.length === 0 || B.length === 0) return A.length === B.length ? 1 : 0
  const counts = new Map<string, number>()
  for (const bg of A) counts.set(bg, (counts.get(bg) ?? 0) + 1)
  let overlap = 0
  for (const bg of B) {
    const c = counts.get(bg) ?? 0
    if (c > 0) {
      overlap++
      counts.set(bg, c - 1)
    }
  }
  return (2 * overlap) / (A.length + B.length)
}

/** Below this, a "match" is more likely coincidence than a name variant — don't suggest it. */
export const FUZZY_MATCH_THRESHOLD = 0.6

export function bestFuzzyMatch(target: string, candidates: string[]): { value: string; score: number } | null {
  let best: { value: string; score: number } | null = null
  for (const c of candidates) {
    const score = diceCoefficient(target, c)
    if (!best || score > best.score) best = { value: c, score }
  }
  return best
}
