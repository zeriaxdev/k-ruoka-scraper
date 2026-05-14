import { getById } from "../scraper";
import { getTrackedProducts, recordPrice } from "../cache";

export async function refreshTracked(): Promise<number> {
  const ids = await getTrackedProducts();
  let count = 0;

  for (const id of ids) {
    const product = await getById(id);
    if (product?.price != null) {
      await recordPrice(product.id, product.price, product.unitPrice);
      count++;
    }
  }

  return count;
}
