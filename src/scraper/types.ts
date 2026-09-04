/**
 * Active discount on a product, from `mobilescan.pricing.discount`.
 * NOTE: K-Ruoka exposes no multi-buy / quantity-threshold promo
 * ("4 kpl 5,00 €") on this endpoint — `maxItems` is a purchase cap, not a
 * required quantity. See README "Promotions".
 */
export type Promo = {
  /** Discounted unit price actually charged. */
  price: number;
  unitPrice?: number;
  discountPercentage?: number;
  /** Localized label, e.g. "\u22129 %". */
  discountText?: string;
  /** "STANDARD" (price cut) or "PLUSSA" (loyalty-card only). */
  type?: string;
  startDate?: string;
  endDate?: string;
  daysLeft?: number;
  /** Max units at the discounted price, when capped. */
  maxItems?: number;
  campaignId?: string;
  availability?: { web?: boolean; store?: boolean };
  /** EU price-history reference ("lowest price in the last 30 days"). */
  lowestPriceBeforeDiscount?: number;
};

export type Product = {
  id: string;
  ean?: string;
  name: string;
  brand?: string;
  /** Normal (undiscounted) price. */
  price: number;
  /** Price actually charged today: promo price when on offer, else `price`. */
  effectivePrice: number;
  promo?: Promo;
  unitPrice?: number;
  unit?: string;
  soldBy?: "piece" | "weight";
  size?: number;
  sizeUnit?: string;
  categoryPath?: string[];
  categorySlug?: string;
  countryOfOrigin?: string;
  isDomestic?: boolean;
  image?: string;
  url: string;
  isAvailable?: boolean;
  popularity?: number;
};

export type ProductDetail = Product & {
  description?: string;
  ingredients?: string;
  allergens?: { contains?: string[]; mayContain?: string[] };
  nutrition?: {
    energyKcal?: number;
    energyKj?: number;
    fat?: number;
    fatSaturated?: number;
    carbohydrates?: number;
    sugars?: number;
    protein?: number;
    salt?: number;
  };
  manufacturer?: string;
  alcoholPercentage?: number;
  labels?: string[];
  restriction?: string;
  weight?: number;
  dimensions?: { width?: number; height?: number; length?: number };
};

export type PriceSnapshot = {
  price: number;
  unitPrice?: number;
  timestamp: number;
};
