import type { Product, ProductDetail } from "./types";
import { RateLimiter } from "./rate-limit";

const BASE_SEARCH = "https://www.k-ruoka.fi/kr-api/v2/product-search";
const BASE_DETAIL = "https://www.k-ruoka.fi/kr-api/v4/products";
const limiter = new RateLimiter(10, 2);

const HEADERS = {
  accept: "application/json",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  "x-k-build-number": "30858",
  "x-k-experiments":
    "ab4d.10001.0!d2ae.10003.s2!a.00149.0!a.00159.0!a.00160.1!a.00164.1!a.00167.1!a.00168.0",
};

function mapProduct(item: any): Product {
  const p = item.product;
  const pricing = p.mobilescan?.pricing?.normal;
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

  await limiter.acquire();
  const res = await fetch(url, { method: "POST", headers: HEADERS });

  if (!res.ok) {
    throw new Error(`K-Ruoka API returned HTTP ${res.status}`);
  }

  const json: any = await res.json();
  return json.result.map(mapProduct);
}

export async function getById(id: string): Promise<Product | null> {
  const results = await search(id, 10);
  return results.find((p) => p.id === id || p.ean === id) ?? null;
}

export async function getDetail(slugOrId: string): Promise<ProductDetail | null> {
  const url = `${BASE_DETAIL}/${slugOrId}?storeId=N106&returnLocalProductsFromOtherStores=true`;

  await limiter.acquire();
  const res = await fetch(url, { headers: HEADERS });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`K-Ruoka v4 API returned HTTP ${res.status}`);
  }

  const json: any = await res.json();
  return mapDetail(json);
}
