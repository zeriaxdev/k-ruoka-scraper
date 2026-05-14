import { routes } from "./routes";

const PORT = Number(process.env.PORT ?? 3000);

Bun.serve({
  port: PORT,
  routes,
});

console.log(`kruoka api listening on http://localhost:${PORT}`);
