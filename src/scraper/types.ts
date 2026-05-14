export type Product = {
  id: string;
  ean?: string;
  name: string;
  brand?: string;
  price: number;
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
