import { search, getById } from "../scraper";
import {
  recordPrice,
  getPriceHistory,
  trackProduct,
  untrackProduct,
  getTrackedProducts,
} from "../cache";
import { refreshTracked } from "../jobs/refresh";

const [command, ...args] = process.argv.slice(2);

function usage() {
  console.log(`
kruoka — K-Ruoka price tracker CLI

Usage:
  kruoka search <query> [--limit=N]     Search products
  kruoka product <id>                   Get product details
  kruoka track <id>                     Start tracking a product
  kruoka untrack <id>                   Stop tracking a product
  kruoka tracked                        List tracked products
  kruoka history <id>                   Show price history
  kruoka refresh                        Refresh prices for all tracked products
  kruoka help                           Show this message
`.trim());
}

function formatPrice(price?: number, unit?: string): string {
  if (price == null) return "N/A";
  return `${price.toFixed(2)}€${unit ? `/${unit}` : ""}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("fi-FI", { timeZone: "Europe/Helsinki" });
}

function parseLimit(): number {
  const flag = args.find((a) => a.startsWith("--limit="));
  return flag ? Math.min(Number(flag.split("=")[1]), 200) : 20;
}

async function main() {
  switch (command) {
    case "search":
    case "s": {
      const query = args.filter((a) => !a.startsWith("--")).join(" ");
      if (!query) {
        console.error("Usage: kruoka search <query>");
        process.exit(1);
      }
      const results = await search(query, parseLimit());
      if (results.length === 0) {
        console.log("No results found.");
        break;
      }
      const maxName = Math.min(
        40,
        Math.max(...results.map((p) => p.name.length))
      );
      for (const p of results) {
        const name = p.name.padEnd(maxName).slice(0, maxName);
        const price = formatPrice(p.price, p.unit);
        console.log(`  ${p.id}  ${name}  ${price}`);
      }
      console.log(`\n${results.length} results`);
      break;
    }

    case "product":
    case "p": {
      const id = args[0];
      if (!id) {
        console.error("Usage: kruoka product <id>");
        process.exit(1);
      }
      const product = await getById(id);
      if (!product) {
        console.error("Product not found.");
        process.exit(1);
      }
      console.log(`
${product.name} (${product.brand ?? "unknown brand"})
  ID:       ${product.id}
  EAN:      ${product.ean ?? "N/A"}
  Price:    ${formatPrice(product.price, product.unit)}
  Unit:     ${formatPrice(product.unitPrice, product.unit)}
  Size:     ${product.size ?? "?"} ${product.sizeUnit ?? ""}
  Category: ${product.categoryPath?.join(" > ") ?? "N/A"}
  Origin:   ${product.countryOfOrigin ?? "N/A"} ${product.isDomestic ? "(domestic)" : ""}
  URL:      ${product.url}
`.trim());
      break;
    }

    case "track":
    case "t": {
      const id = args[0];
      if (!id) {
        console.error("Usage: kruoka track <id>");
        process.exit(1);
      }
      await trackProduct(id);
      const product = await getById(id);
      console.log(`Tracking ${product?.name ?? id}`);
      break;
    }

    case "untrack":
    case "ut": {
      const id = args[0];
      if (!id) {
        console.error("Usage: kruoka untrack <id>");
        process.exit(1);
      }
      await untrackProduct(id);
      console.log(`Stopped tracking ${id}`);
      break;
    }

    case "tracked":
    case "ls": {
      const ids = await getTrackedProducts();
      if (ids.length === 0) {
        console.log("No tracked products. Use 'kruoka track <id>' to start.");
        break;
      }
      for (const id of ids) {
        const product = await getById(id);
        if (product) {
          console.log(
            `  ${product.id}  ${product.name}  ${formatPrice(product.price, product.unit)}`
          );
        } else {
          console.log(`  ${id}  (not found)`);
        }
      }
      console.log(`\n${ids.length} tracked`);
      break;
    }

    case "history":
    case "h": {
      const id = args[0];
      if (!id) {
        console.error("Usage: kruoka history <id>");
        process.exit(1);
      }
      const history = await getPriceHistory(id);
      if (history.length === 0) {
        console.log("No price history. Search or fetch this product first.");
        break;
      }
      const product = await getById(id);
      console.log(`Price history for ${product?.name ?? id}:\n`);
      let prev: number | null = null;
      for (const snap of history) {
        const delta =
          prev != null
            ? snap.price > prev
              ? ` ▲ +${(snap.price - prev).toFixed(2)}`
              : snap.price < prev
                ? ` ▼ ${(snap.price - prev).toFixed(2)}`
                : ""
            : "";
        console.log(`  ${formatDate(snap.timestamp)}  ${snap.price.toFixed(2)}€${delta}`);
        prev = snap.price;
      }
      break;
    }

    case "refresh":
    case "r": {
      const count = await refreshTracked();
      console.log(`Refreshed ${count} tracked products.`);
      break;
    }

    case "help":
    case undefined:
      usage();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }

  process.exit(0);
}

main();
