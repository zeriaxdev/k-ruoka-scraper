import { search, getById, getDetail, compareBasket, UpstreamError } from "../scraper";
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
  // Probes hit "/" — answer without Redis so a degraded cache isn't a dead app.
  "/": () => new Response("ok"),
  "/health": () => new Response("ok"),

  "/api/health": {
    async GET() {
      try {
        await Promise.race([
          redis.ping(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("redis ping timed out")), 2000)
          ),
        ]);
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

  "/api/compare": {
    async POST(req: Request) {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "body must be JSON" }, { status: 400 });
      }

      const items = body?.items;
      if (!Array.isArray(items) || items.length === 0 || !items.every((i) => typeof i === "string" && i.trim())) {
        return Response.json(
          { error: "body must be { items: string[] } with at least one non-empty name" },
          { status: 400 }
        );
      }
      if (items.length > 50) {
        return Response.json({ error: "at most 50 items per basket" }, { status: 400 });
      }

      const sort = body?.sort ?? "relevance";
      if (!["relevance", "price", "unitPrice"].includes(sort)) {
        return Response.json(
          { error: 'sort must be "relevance", "price" or "unitPrice"' },
          { status: 400 }
        );
      }

      const result = await compareBasket(
        items.map((i: string) => i.trim()),
        20,
        sort
      );

      for (const { match } of result.items) {
        if (match?.price != null) {
          await recordPrice(match.id, match.price, match.unitPrice);
        }
      }

      return Response.json(result);
    },
  },

  "/api/tracked": {
    async GET() {
      const ids = await getTrackedProducts();
      return Response.json(ids);
    },
  },
} as Record<string, any>;

/** Surface the real upstream failure instead of a bare 500. */
function errorResponse(err: unknown): Response {
  if (err instanceof UpstreamError) {
    return Response.json(
      {
        error: err.message,
        kind: err.kind,
        upstreamStatus: err.status,
        detail: err.detail,
      },
      { status: err.kind === "challenge" ? 503 : 502 }
    );
  }
  console.error(err);
  return Response.json({ error: (err as Error)?.message ?? "internal error" }, { status: 500 });
}

for (const route of Object.values(routes)) {
  if (typeof route === "function") continue; // bare handler, e.g. "/" probe
  for (const [method, handler] of Object.entries(route as Record<string, any>)) {
    (route as any)[method] = async (req: Request) => {
      try {
        return await handler(req);
      } catch (err) {
        return errorResponse(err);
      }
    };
  }
}
