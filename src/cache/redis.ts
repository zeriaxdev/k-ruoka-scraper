import { RedisClient } from "bun";
import type { PriceSnapshot } from "../scraper";

const redis = new RedisClient(process.env.REDIS_URL ?? "redis://localhost:6379");

// Bun's redis client blocks forever when the server is gone, so bound every op
// and degrade to a no-op rather than hanging the caller.
const OP_TIMEOUT_MS = 1000;
const RETRY_AFTER_MS = 30_000;
let degradedUntil = 0;

export function redisAvailable() {
  return Date.now() >= degradedUntil;
}

async function tryRedis<T>(label: string, op: () => Promise<T>, fallback: T): Promise<T> {
  if (!redisAvailable()) return fallback;
  try {
    return await Promise.race([
      op(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out")), OP_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    degradedUntil = Date.now() + RETRY_AFTER_MS;
    console.error(
      `[kruoka] Redis unavailable (${label}: ${(err as Error).message}). ` +
        `Caching, price history and tracking are disabled for ${RETRY_AFTER_MS / 1000}s.`,
    );
    return fallback;
  }
}

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
  await tryRedis(
    "recordPrice",
    () =>
      redis.zadd(
        KEY.priceHistory(id),
        String(snapshot.timestamp),
        JSON.stringify(snapshot)
      ),
    undefined
  );
}

export async function getPriceHistory(id: string): Promise<PriceSnapshot[]> {
  const raw = await tryRedis(
    "getPriceHistory",
    () => redis.zrange(KEY.priceHistory(id), "0", "-1"),
    [] as string[]
  );
  return raw.map((entry: string) => JSON.parse(entry));
}

export async function getCachedSearch(
  query: string,
  limit: number
): Promise<string | null> {
  return tryRedis(
    "getCachedSearch",
    () => redis.get(KEY.searchCache(query, limit)),
    null
  );
}

export async function setCachedSearch(
  query: string,
  limit: number,
  data: string
) {
  await tryRedis(
    "setCachedSearch",
    () => redis.set(KEY.searchCache(query, limit), data, "EX", SEARCH_TTL),
    undefined
  );
}

export async function trackProduct(id: string) {
  await tryRedis("trackProduct", () => redis.sadd(KEY.tracked(), id), undefined);
}

export async function untrackProduct(id: string) {
  await tryRedis("untrackProduct", () => redis.srem(KEY.tracked(), id), undefined);
}

export async function getTrackedProducts(): Promise<string[]> {
  return tryRedis("getTrackedProducts", () => redis.smembers(KEY.tracked()), []);
}

export { redis };
