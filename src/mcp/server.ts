import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { search, getById, getDetail } from "../scraper";
import {
  recordPrice,
  getPriceHistory,
  trackProduct,
  untrackProduct,
  getTrackedProducts,
} from "../cache";
import { refreshTracked } from "../jobs/refresh";

const server = new McpServer({
  name: "kruoka",
  version: "0.1.0",
});

const SEARCH_FORMAT = `Search K-Ruoka products by name or keyword.

DISPLAY: Render each result as a horizontal card row. For each product show:

![](image_url)
**Product Name** — Brand
**€X.XX** · X.XX €/unit · size
\`ID: 6410405082657\`

Use a clean list layout, no tables. Keep it scannable. Show the ID small/muted so the user can copy it for other tools. Add a total count at the bottom.`;

const PRODUCT_FORMAT = `Get a single product by ID or EAN (basic info).
Use get_product_detail for nutrition/ingredients.

DISPLAY: Render as a card with the image on top:

![](image_url)

### Product Name
**Brand** · Category breadcrumb

**€X.XX**
X.XX €/unit · size · origin flag

Available: ✓/✗
[View on K-Ruoka →](url)`;

const DETAIL_FORMAT = `Get full product details from K-Ruoka v4 API — nutrition, ingredients, allergens, manufacturer, labels.
Requires the product URL slug (last segment of the product url, e.g. "pirkka-olut-033l-45-tlk-6410405091260").

DISPLAY: Render as a detailed product page. Use this exact layout:

![](image_url)

### Product Name
**Brand** · Manufacturer

---

**€X.XX** · X.XX €/unit
Size · Weight · Origin

---

**Labels:** Hyvää Suomesta, etc.

**Ingredients**
Full ingredient text

**Allergens**
Contains: list · May contain: list

**Nutrition** per 100ml/g

| | |
|:--|--:|
| Energy | XX kcal |
| Fat | Xg |
| — Saturated | Xg |
| Carbohydrates | Xg |
| — Sugars | Xg |
| Protein | Xg |
| Salt | Xg |

If alcohol: **Alcohol: X.X%**
If restriction: **⚠ Restriction text**

[View on K-Ruoka →](url)

Keep it clean and minimal. No emoji spam. Use horizontal rules to separate sections. Omit sections that have no data.`;

const HISTORY_FORMAT = `Get price history for a product. Returns timestamped price snapshots.

DISPLAY: Show as a clean list of dated entries. Mark changes with ▲ or ▼ and the delta amount. Summarize the overall trend at the end if there's enough data (e.g. "Stable at €0.99" or "Increased €0.10 over 2 weeks").`;

server.tool(
  "search",
  SEARCH_FORMAT,
  {
    query: z.string().describe("Search query, e.g. 'maito', 'leipä', 'Valio'"),
    limit: z.number().min(1).max(200).default(20).describe("Max results"),
  },
  async ({ query, limit }) => {
    const results = await search(query, limit);

    for (const p of results) {
      if (p.price != null) {
        await recordPrice(p.id, p.price, p.unitPrice);
      }
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(results, null, 2) },
      ],
    };
  }
);

server.tool(
  "get_product",
  PRODUCT_FORMAT,
  {
    id: z.string().describe("Product ID or EAN barcode"),
  },
  async ({ id }) => {
    const product = await getById(id);
    if (!product) {
      return {
        content: [{ type: "text" as const, text: `Product ${id} not found.` }],
        isError: true,
      };
    }

    if (product.price != null) {
      await recordPrice(product.id, product.price, product.unitPrice);
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(product, null, 2) },
      ],
    };
  }
);

server.tool(
  "get_product_detail",
  DETAIL_FORMAT,
  {
    slug: z
      .string()
      .describe(
        "Product URL slug (e.g. 'pirkka-olut-033l-45-tlk-6410405091260'). Extract from a product's url field by taking the last path segment."
      ),
  },
  async ({ slug }) => {
    const detail = await getDetail(slug);
    if (!detail) {
      return {
        content: [
          { type: "text" as const, text: `Product not found for slug: ${slug}` },
        ],
        isError: true,
      };
    }

    if (detail.price != null) {
      await recordPrice(detail.id, detail.price, detail.unitPrice);
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(detail, null, 2) },
      ],
    };
  }
);

server.tool(
  "price_history",
  HISTORY_FORMAT,
  {
    id: z.string().describe("Product ID or EAN"),
  },
  async ({ id }) => {
    const history = await getPriceHistory(id);
    if (history.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No price history for ${id}. Search or fetch the product first to start recording.`,
          },
        ],
      };
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(history, null, 2) },
      ],
    };
  }
);

server.tool(
  "track_product",
  "Start tracking a product for periodic price updates. Confirm with a short message including the product name.",
  {
    id: z.string().describe("Product ID to track"),
  },
  async ({ id }) => {
    await trackProduct(id);
    const product = await getById(id);
    return {
      content: [
        {
          type: "text" as const,
          text: `Now tracking ${product?.name ?? id} (${id})`,
        },
      ],
    };
  }
);

server.tool(
  "untrack_product",
  "Stop tracking a product. Confirm with a short message.",
  {
    id: z.string().describe("Product ID to stop tracking"),
  },
  async ({ id }) => {
    await untrackProduct(id);
    return {
      content: [
        { type: "text" as const, text: `Stopped tracking ${id}` },
      ],
    };
  }
);

server.tool(
  "list_tracked",
  "List all tracked product IDs. Show as a clean numbered list.",
  {},
  async () => {
    const ids = await getTrackedProducts();
    if (ids.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No products are being tracked.",
          },
        ],
      };
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(ids, null, 2) },
      ],
    };
  }
);

server.tool(
  "refresh_tracked",
  "Refresh prices for all tracked products immediately. Report how many were updated.",
  {},
  async () => {
    const count = await refreshTracked();
    return {
      content: [
        {
          type: "text" as const,
          text: `Refreshed prices for ${count} tracked products.`,
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
