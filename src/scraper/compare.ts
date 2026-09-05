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

/** "relevance" keeps K-Ruoka's own result order, which is what a shopper means. */
export type SortBy = "relevance" | "price" | "unitPrice";

/** Best in-stock match under the chosen ordering. Null when nothing qualifies. */
export function pick(
  products: Product[],
  sort: SortBy = "relevance",
): Product | null {
  const usable = products.filter(
    (p) => typeof p.effectivePrice === "number" && p.isAvailable !== false,
  );
  if (usable.length === 0) return null;

  if (sort === "relevance") return usable[0]!;
  if (sort === "unitPrice") {
    return usable.reduce((a, b) =>
      (b.unitPrice ?? Infinity) < (a.unitPrice ?? Infinity) ? b : a,
    );
  }
  return usable.reduce((a, b) => (b.effectivePrice < a.effectivePrice ? b : a));
}

/** Cheapest in-stock product by the price actually charged today. */
export function cheapest(products: Product[]): Product | null {
  return pick(products, "price");
}

/** `searchFn` is injectable so this is testable without upstream access. */
export async function compareBasket(
  items: string[],
  limit = 20,
  sort: SortBy = "relevance",
  searchFn: (q: string, n: number) => Promise<Product[]> = liveSearch,
): Promise<CompareResult> {
  const matches: CompareMatch[] = await Promise.all(
    items.map(async (query) => {
      try {
        const match = pick(await searchFn(query, limit), sort);
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
    savings:
      Math.round(
        found.reduce((s, m) => s + (m.match!.price - m.match!.effectivePrice), 0) * 100,
      ) / 100,
    total: Math.round(found.reduce((sum, m) => sum + m.match!.effectivePrice, 0) * 100) / 100,
    matched: found.length,
    unmatched: matches.filter((m) => !m.match).map((m) => m.query),
  };
}
