import { test, expect } from "bun:test";
import { cheapest, compareBasket } from "./compare";
import type { Product } from "./types";

const p = (id: string, price: number, extra: Partial<Product> = {}): Product =>
  ({ id, name: id, price, effectivePrice: price, url: "", ...extra }) as Product;

/** Product whose promo price undercuts its shelf price. */
const onOffer = (id: string, price: number, promoPrice: number): Product =>
  ({ ...p(id, price), effectivePrice: promoPrice, promo: { price: promoPrice } }) as Product;

test("cheapest skips unavailable and unpriced items", () => {
  expect(cheapest([p("a", 5), p("b", 2, { isAvailable: false }), p("c", 3)])?.id).toBe("c");
  expect(cheapest([p("a", undefined as any), p("b", 1)])?.id).toBe("b");
  expect(cheapest([])).toBeNull();
});

test("cheapest and totals use the promo price, not the shelf price", async () => {
  expect(cheapest([p("plain", 2.0), onOffer("deal", 2.5, 1.5)])?.id).toBe("deal");

  const r = await compareBasket(["x"], 20, async () => [onOffer("deal", 2.5, 1.5)]);
  expect(r.total).toBe(1.5);
  expect(r.savings).toBe(1);
});

test("compareBasket totals cheapest matches and reports misses", async () => {
  const fake = async (q: string) =>
    q === "maito" ? [p("m1", 1.29), p("m2", 0.99)] : q === "leipä" ? [p("l1", 2.5)] : [];

  const r = await compareBasket(["maito", "leipä", "kaviaari"], 20, fake);
  expect(r.total).toBe(3.49);
  expect(r.matched).toBe(2);
  expect(r.unmatched).toEqual(["kaviaari"]);
});

test("compareBasket isolates a failing item instead of failing the basket", async () => {
  const fake = async (q: string) => {
    if (q === "boom") throw new Error("HTTP 403");
    return [p("x", 1)];
  };
  const r = await compareBasket(["ok", "boom"], 20, fake);
  expect(r.total).toBe(1);
  expect(r.items[1]!.error).toBe("HTTP 403");
});
