import { RedisClient } from "bun";
import type { PriceSnapshot } from "../scraper";

const redis = new RedisClient(process.env.REDIS_URL ?? "redis://localhost:6379");

const KEY = {
  priceHistory: (id: string) => `kruoka:price:${id}`,
  searchCache: (q: string, limit: number) => `kruoka:search:${q}:${limit}`,
  tracked: () => "kruoka:tracked",
};

const SEARCH_TTL = 300;

export async function recordPrice(
  id: string,
  price: number,
  unitPrice?: number
) {
  const snapshot: PriceSnapshot = { price, unitPrice, timestamp: Date.now() };
  await redis.zadd(
    KEY.priceHistory(id),
    String(snapshot.timestamp),
    JSON.stringify(snapshot)
  );
}

export async function getPriceHistory(id: string): Promise<PriceSnapshot[]> {
  const raw = await redis.zrange(KEY.priceHistory(id), "0", "-1");
  return raw.map((entry: string) => JSON.parse(entry));
}

export async function getCachedSearch(
  query: string,
  limit: number
): Promise<string | null> {
  return redis.get(KEY.searchCache(query, limit));
}

export async function setCachedSearch(
  query: string,
  limit: number,
  data: string
) {
  await redis.set(KEY.searchCache(query, limit), data, "EX", SEARCH_TTL);
}

export async function trackProduct(id: string) {
  await redis.sadd(KEY.tracked(), id);
}

export async function untrackProduct(id: string) {
  await redis.srem(KEY.tracked(), id);
}

export async function getTrackedProducts(): Promise<string[]> {
  return redis.smembers(KEY.tracked());
}

export { redis };
