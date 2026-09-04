import type { Product } from "./types";
import { search as liveSearch } from "./client";

export type CompareMatch = {
  query: string;
  match: Product | null;
  /** Why no match, when match is null. */
  error?: string;
};

export type CompareResult = {
  items: CompareMatch[];
  /** Sum of effective (post-discount) prices. */
  total: number;
  /** How much the active promos take off the total. */
  savings: number;
  matched: number;
  unmatched: string[];
};

/**
 * Cheapest in-stock product by the price actually charged today — a product
 * on offer competes at its promo price. Null when nothing qualifies.
 */
export function cheapest(products: Product[]): Product | null {
  const usable = products.filter(
    (p) => typeof p.effectivePrice === "number" && p.isAvailable !== false,
  );
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => (b.effectivePrice < a.effectivePrice ? b : a));
}

/**
 * Resolve each basket item by search, keep the cheapest hit, and total them up.
 * `searchFn` is injectable so the logic is testable without upstream access.
 */
export async function compareBasket(
  items: string[],
  limit = 20,
  searchFn: (q: string, n: number) => Promise<Product[]> = liveSearch,
): Promise<CompareResult> {
  const matches: CompareMatch[] = await Promise.all(
    items.map(async (query) => {
      try {
        const match = cheapest(await searchFn(query, limit));
        return match
          ? { query, match }
          : { query, match: null, error: "no priced, available result" };
      } catch (err) {
        return { query, match: null, error: (err as Error).message };
      }
    }),
  );

  const found = matches.filter((m) => m.match);
  return {
    items: matches,
    // ponytail: cents rounding — basket totals are small, no money type needed.
    savings:
      Math.round(
        found.reduce((s, m) => s + (m.match!.price - m.match!.effectivePrice), 0) * 100,
      ) / 100,
    total: Math.round(found.reduce((sum, m) => sum + m.match!.effectivePrice, 0) * 100) / 100,
    matched: found.length,
    unmatched: matches.filter((m) => !m.match).map((m) => m.query),
  };
}
