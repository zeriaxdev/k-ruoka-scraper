import { search, getById, getDetail } from "../scraper";
import {
  recordPrice,
  getPriceHistory,
  getCachedSearch,
  setCachedSearch,
  trackProduct,
  untrackProduct,
  getTrackedProducts,
  redis,
} from "../cache";

export const routes = {
  "/api/health": {
    async GET() {
      try {
        await redis.ping();
        return Response.json({ status: "ok", redis: "connected" });
      } catch {
        return Response.json(
          { status: "degraded", redis: "disconnected" },
          { status: 503 }
        );
      }
    },
  },

  "/api/search": {
    async GET(req: Request) {
      const params = new URL(req.url).searchParams;
      const q = params.get("q");
      if (!q) {
        return Response.json({ error: "missing ?q= parameter" }, { status: 400 });
      }

      const limit = Math.min(Number(params.get("limit") ?? 50), 200);

      const cached = await getCachedSearch(q, limit);
      if (cached) {
        return Response.json(JSON.parse(cached));
      }

      const results = await search(q, limit);
      await setCachedSearch(q, limit, JSON.stringify(results));

      for (const product of results) {
        if (product.price != null) {
          await recordPrice(product.id, product.price, product.unitPrice);
        }
      }

      return Response.json(results);
    },
  },

  "/api/product/:id": {
    async GET(req: Request) {
      const id = (req as any).params.id;
      const product = await getById(id);
      if (!product) {
        return Response.json({ error: "product not found" }, { status: 404 });
      }

      if (product.price != null) {
        await recordPrice(product.id, product.price, product.unitPrice);
      }

      return Response.json(product);
    },
  },

  "/api/product/detail/:slug": {
    async GET(req: Request) {
      const slug = (req as any).params.slug;
      const detail = await getDetail(slug);
      if (!detail) {
        return Response.json({ error: "product not found" }, { status: 404 });
      }

      if (detail.price != null) {
        await recordPrice(detail.id, detail.price, detail.unitPrice);
      }

      return Response.json(detail);
    },
  },

  "/api/product/:id/history": {
    async GET(req: Request) {
      const id = (req as any).params.id;
      const history = await getPriceHistory(id);
      return Response.json(history);
    },
  },

  "/api/track/:id": {
    async POST(req: Request) {
      const id = (req as any).params.id;
      await trackProduct(id);
      return Response.json({ tracked: true, id });
    },
    async DELETE(req: Request) {
      const id = (req as any).params.id;
      await untrackProduct(id);
      return Response.json({ tracked: false, id });
    },
  },

  "/api/tracked": {
    async GET() {
      const ids = await getTrackedProducts();
      return Response.json(ids);
    },
  },
} as Record<string, any>;
