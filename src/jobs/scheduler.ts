import { refreshTracked } from "./refresh";

const INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS ?? 3600_000); // default 1 hour

async function tick() {
  const start = Date.now();
  const count = await refreshTracked();
  const elapsed = Date.now() - start;
  console.log(
    `[${new Date().toISOString()}] refreshed ${count} products in ${elapsed}ms`
  );
}

console.log(
  `scheduler started — refreshing every ${(INTERVAL_MS / 60_000).toFixed(0)}min`
);
tick();
setInterval(tick, INTERVAL_MS);
