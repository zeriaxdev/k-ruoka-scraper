import type { Product, ProductDetail, Promo } from "./types";
import { RateLimiter } from "./rate-limit";

const BASE_SEARCH = "https://www.k-ruoka.fi/kr-api/v2/product-search";
const BASE_DETAIL = "https://www.k-ruoka.fi/kr-api/v4/products";
const limiter = new RateLimiter(10, 2);

const HEADERS = {
  accept: "application/json",
  "accept-language": "fi-FI,fi;q=0.9,en;q=0.8",
  referer: "https://www.k-ruoka.fi/kauppa",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  "x-k-build-number": "30858",
  "x-k-experiments":
    "ab4d.10001.0!d2ae.10003.s2!a.00149.0!a.00159.0!a.00160.1!a.00164.1!a.00167.1!a.00168.0",
};

const MAX_ATTEMPTS = 3;

/** Error carrying the *real* upstream failure, instead of a bare 403. */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: "challenge" | "http" | "network" | "parse",
    readonly detail?: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/**
 * K-Ruoka sits behind Cloudflare. When Cloudflare decides to challenge the
 * caller it answers *every* path (including the homepage) with 403 +
 * `cf-mitigated: challenge` and a "Just a moment..." interstitial. No
 * combination of request headers clears it — it wants a browser to run the
 * JS challenge. Detect it so callers get a truthful diagnosis.
 */
function challengeInfo(res: Response, body: string): string | null {
  if (res.headers.get("cf-mitigated") === "challenge") {
    return `cf-ray ${res.headers.get("cf-ray") ?? "unknown"}`;
  }
  if (/Just a moment\.\.\.|\/cdn-cgi\/challenge-platform/.test(body)) {
    return `cf-ray ${res.headers.get("cf-ray") ?? "unknown"}`;
  }
  return null;
}

// ponytail: retry only what a retry can fix — throttling, upstream 5xx and
// transport blips. A Cloudflare challenge and a 4xx are deterministic, so
// retrying them just hammers the origin.
function isRetryable(status: number) {
  return status === 429 || status >= 500;
}

async function backoff(attempt: number) {
  const ms = 250 * 2 ** (attempt - 1) * (1 + Math.random() * 0.3);
  await new Promise((r) => setTimeout(r, ms));
}

/** Optional raw-payload capture: KRUOKA_RAW_DUMP=/some/dir bun run ... */
async function dumpRaw(label: string, body: string) {
  const dir = process.env.KRUOKA_RAW_DUMP;
  if (!dir) return;
  const safe = label.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80);
  const file = `${dir}/${Date.now()}-${safe}.json`;
  await Bun.write(file, body);
  console.error(`[kruoka] raw response written to ${file}`);
}

/** @internal exported for tests */
export async function fetchJson(url: string, init: RequestInit, label: string): Promise<any> {
  let last: UpstreamError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await limiter.acquire();

    let res: Response;
    try {
      res = await fetch(url, { ...init, headers: HEADERS });
    } catch (err) {
      last = new UpstreamError(
        `Network error contacting K-Ruoka: ${(err as Error).message}`,
        0,
        "network",
      );
      if (attempt < MAX_ATTEMPTS) {
        await backoff(attempt);
        continue;
      }
      throw last;
    }

    const body = await res.text();

    if (res.ok) {
      await dumpRaw(label, body);
      try {
        return JSON.parse(body);
      } catch {
        throw new UpstreamError(
          "K-Ruoka returned a non-JSON body on a 200 response",
          res.status,
          "parse",
          body.slice(0, 300),
        );
      }
    }

    const challenge = challengeInfo(res, body);
    if (challenge) {
      throw new UpstreamError(
        `K-Ruoka is behind a Cloudflare bot challenge (HTTP ${res.status}, ${challenge}). ` +
          `The API is not reachable from this host — this is not a header or auth problem.`,
        res.status,
        "challenge",
        challenge,
      );
    }

    last = new UpstreamError(
      `K-Ruoka API returned HTTP ${res.status} ${res.statusText}`,
      res.status,
      "http",
      body.slice(0, 300),
    );

    if (isRetryable(res.status) && attempt < MAX_ATTEMPTS) {
      await backoff(attempt);
      continue;
    }
    throw last;
  }

  throw last!;
}

function mapPromo(pricing: any, mobilescan: any): Promo | undefined {
  const d = pricing?.discount;
  if (!d || d.price == null) return undefined;
  return {
    price: d.price,
    unitPrice: d.unitPrice?.value,
    discountPercentage: d.discountPercentage,
    discountText: d.discountPercentageText,
    type: d.discountType,
    startDate: d.startDate,
    endDate: d.endDate,
    daysLeft: d.validNumberOfDaysLeft,
    maxItems: d.maxItems,
    campaignId: d.campaignId,
    availability: d.discountAvailability,
    lowestPriceBeforeDiscount: mobilescan?.lowestPriceBeforeDiscount?.value,
  };
}

function mapProduct(item: any): Product {
  const p = item.product;
  const pricing = p.mobilescan?.pricing?.normal;
  const promo = mapPromo(p.mobilescan?.pricing, p.mobilescan);
  const attrs = p.productAttributes;
  const measurements = attrs?.measurements;
  const origin = attrs?.origin;
  const categoryTree = p.category?.tree ?? [];

  return {
    id: p.id,
    ean: p.ean,
    name: p.localizedName?.finnish ?? p.localizedName?.english,
    brand: p.brand?.name,
    price: pricing?.price,
    effectivePrice: promo?.price ?? pricing?.price,
    promo,
    unitPrice: pricing?.unitPrice?.value,
    unit: pricing?.unitPrice?.unit,
    soldBy: pricing?.soldBy?.kind,
    size: measurements?.contentSize,
    sizeUnit: measurements?.contentUnit,
    categoryPath: categoryTree.map((c: any) => c.slug),
    categorySlug: categoryTree.at(-1)?.slug,
    countryOfOrigin: origin?.countryOfOrigin,
    isDomestic: p.productAttributes?.responsibility?.some(
      (r: any) => r.name === "domestic"
    ),
    image: attrs?.image?.url ?? p.images?.[0],
    url: `https://www.k-ruoka.fi/kauppa/tuote/${attrs?.urlSlug ?? p.id}`,
    isAvailable: p.isAvailable,
    popularity: p.popularity,
  };
}

function mapDetail(data: any): ProductDetail {
  const p = data.product;
  const pricing = p.mobilescan?.pricing?.normal;
  const promo = mapPromo(p.mobilescan?.pricing, p.mobilescan);
  const attrs = p.productAttributes ?? {};
  const measurements = attrs.measurements ?? {};
  const origin = attrs.origin ?? {};
  const categoryTree = p.category?.tree ?? [];
  const nutrition = attrs.nutritionalContents?.[0]?.nutrients;
  const allergens = attrs.localizedAllergens;
  const contacts = attrs.contactInformation?.fi ?? [];
  const manufacturer = contacts.find(
    (c: any) => c.label === "Valmistaja"
  )?.name;
  const labels = (p.productLabels?.responsibility?.labels ?? []).map(
    (l: any) => l.name?.fi
  );

  return {
    id: p.id,
    ean: p.ean,
    name: p.localizedName?.finnish ?? p.localizedName?.english,
    brand: p.brand?.name,
    price: pricing?.price,
    effectivePrice: promo?.price ?? pricing?.price,
    promo,
    unitPrice: pricing?.unitPrice?.value,
    unit: pricing?.unitPrice?.unit,
    soldBy: pricing?.soldBy?.kind,
    size: measurements.contentSize,
    sizeUnit: measurements.contentUnit,
    categoryPath: categoryTree.map((c: any) => c.slug),
    categorySlug: categoryTree.at(-1)?.slug,
    countryOfOrigin: origin.countryOfOrigin,
    isDomestic: (attrs.responsibility ?? []).some(
      (r: any) => r.name === "domestic"
    ),
    image: attrs.image?.url ?? p.images?.[0],
    url: `https://www.k-ruoka.fi/kauppa/tuote/${attrs.urlSlug ?? p.id}`,
    isAvailable: p.isAvailable,
    popularity: p.popularity,
    description: attrs.description?.fi,
    ingredients: attrs.productContents?.fi,
    allergens: allergens
      ? {
          contains: allergens.contains?.fi,
          mayContain: allergens.mayContain?.fi,
        }
      : undefined,
    nutrition: nutrition
      ? {
          energyKcal: nutrition.energyKcal,
          energyKj: nutrition.energyKj,
          fat: nutrition.fat?.amount,
          fatSaturated: nutrition.fatSaturated?.amount,
          carbohydrates: nutrition.carbohydrates?.amount,
          sugars: nutrition.carbohydratesSugar?.amount,
          protein: nutrition.protein?.amount,
          salt: nutrition.salt?.amount,
        }
      : undefined,
    manufacturer,
    alcoholPercentage: attrs.alcoholAttributes?.alcoholPercentage,
    labels,
    restriction: p.restriction?.i18n?.fi,
    weight: measurements.netWeight,
    dimensions: measurements.width
      ? {
          width: measurements.width,
          height: measurements.height,
          length: measurements.length,
        }
      : undefined,
  };
}

export async function search(query: string, limit = 50): Promise<Product[]> {
  const url =
    `${BASE_SEARCH}/${encodeURIComponent(query)}` +
    `?storeId=N106&offset=0&limit=${limit}`;

  const json = await fetchJson(url, { method: "POST" }, `search-${query}`);
  return json.result.map(mapProduct);
}

export async function getById(id: string): Promise<Product | null> {
  const results = await search(id, 10);
  return results.find((p) => p.id === id || p.ean === id) ?? null;
}

export async function getDetail(slugOrId: string): Promise<ProductDetail | null> {
  const url = `${BASE_DETAIL}/${slugOrId}?storeId=N106&returnLocalProductsFromOtherStores=true`;

  try {
    const json = await fetchJson(url, {}, `detail-${slugOrId}`);
    return mapDetail(json);
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 404) return null;
    throw err;
  }
}
