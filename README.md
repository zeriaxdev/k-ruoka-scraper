# kruoka

K-Ruoka product search and price tracker. Scrapes the K-Ruoka API, serves a REST API, and tracks price history over time via Redis.

## Prerequisites

- [Bun](https://bun.sh) v1.1+
- [Redis](https://redis.io) 7+

## Setup

```bash
bun install
redis-server --daemonize yes
```

## API server

```bash
bun run dev          # hot-reload
bun run start        # production
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check (includes Redis status) |
| `GET` | `/api/search?q=maito&limit=20` | Search products |
| `GET` | `/api/product/:id` | Get product by ID or EAN |
| `GET` | `/api/product/:id/history` | Price history for a product |
| `POST` | `/api/track/:id` | Start tracking a product |
| `DELETE` | `/api/track/:id` | Stop tracking a product |
| `GET` | `/api/tracked` | List all tracked product IDs |
| `POST` | `/api/compare` | Compare a basket: `{"items":["maito","kahvi"]}` |

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API server port |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `REFRESH_INTERVAL_MS` | `3600000` | Scheduler refresh interval (ms) |
| `KRUOKA_RAW_DUMP` | _(unset)_ | Directory to write raw upstream JSON to, for inspecting fields the mapper drops |
| `KRUOKA_STORE_ID` | `N106` | K-Ruoka store code. Pricing and availability are per-store, so set this to the store you actually shop at. An invalid code fails fast with `unknown store id <code>`. |

## CLI

```bash
bun run cli search maito --limit=10
bun run cli product 6410405082657
bun run cli track 6410405082657
bun run cli untrack 6410405082657
bun run cli tracked
bun run cli history 6410405082657
bun run cli refresh
```

### Aliases

| Command | Alias |
|---------|-------|
| `search` | `s` |
| `product` | `p` |
| `track` | `t` |
| `untrack` | `ut` |
| `tracked` | `ls` |
| `history` | `h` |
| `refresh` | `r` |

## MCP server

Exposes kruoka as an MCP tool server for LLMs (Claude Code, etc.).

```bash
bun run mcp
```

### Tools

| Tool | Description |
|------|-------------|
| `search` | Search K-Ruoka products by name or keyword |
| `get_product` | Get a single product by ID or EAN |
| `price_history` | Get price history for a product |
| `track_product` | Start tracking a product |
| `untrack_product` | Stop tracking a product |
| `list_tracked` | List all tracked product IDs |
| `refresh_tracked` | Refresh prices for all tracked products |
| `compare_basket` | Resolve a list of item names to their cheapest match, with a running total |

### Claude Code config

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "kruoka": {
      "command": "bun",
      "args": ["src/mcp/server.ts"],
      "cwd": "/path/to/kruoka"
    }
  }
}
```

## Scheduler

Periodically refreshes prices for all tracked products:

```bash
bun run scheduler
```

## Project structure

```
src/
  api/
    server.ts       Entry point for Bun.serve()
    routes.ts       Route handlers
  scraper/
    types.ts        Product and PriceSnapshot types
    client.ts       K-Ruoka API client
    index.ts        Barrel export
  cache/
    redis.ts        Redis operations (price history, search cache, tracking)
    index.ts        Barrel export
  cli/
    index.ts        CLI entry point
  mcp/
    server.ts       MCP server (stdio transport)
  jobs/
    refresh.ts      Refresh logic for tracked products
    scheduler.ts    Interval-based scheduler
```

## Promotions

Products carry an active discount from `mobilescan.pricing.discount`, exposed as
`promo` alongside `effectivePrice` (the price actually charged today — the promo
price when on offer, otherwise the shelf `price`). Search and comparison rank by
`effectivePrice`, so a discounted product competes at its discounted price.

```jsonc
"price": 4.39,
"effectivePrice": 3.99,
"promo": {
  "price": 3.99,
  "discountPercentage": 9,
  "discountText": "−9 %",
  "type": "STANDARD",          // or "PLUSSA" (loyalty-card only)
  "startDate": "2026-08-31T21:00:00.000Z",
  "endDate": "2026-09-06T20:59:59.000Z",
  "daysLeft": 3,
  "maxItems": 1,               // purchase cap, when capped
  "campaignId": "13297833",
  "availability": { "web": true, "store": true },
  "lowestPriceBeforeDiscount": 4.33
}
```

**Multi-buy promos are not available from this endpoint.** A sweep of 93
discounted products across 12 search queries found only `STANDARD` and `PLUSSA`
discount types, and no quantity-threshold field anywhere in the payload —
nothing expressing "4 kpl 5,00 €". `maxItems` is a cap on how many units get the
discount, not a required quantity. To confirm this yourself on fresh data:

```bash
KRUOKA_RAW_DUMP=./raw bun run cli search kahvi
```

## Upstream 403s

k-ruoka.fi sits behind Cloudflare. When Cloudflare decides to challenge the
caller it answers **every** path — the homepage included — with `403` plus a
`cf-mitigated: challenge` header and a "Just a moment..." interstitial. This is
not an auth, cookie or header problem: no combination of `user-agent`,
`referer` or session headers clears it, because the challenge wants a browser to
execute its JavaScript.

Whether you get challenged depends on the **client and the source IP**, not the
request:

- Bun's `fetch` is generally served normally.
- `curl` from the same machine is challenged for every request.
- Datacenter IPs are challenged far more aggressively than residential ones, so
  a deployed instance can 403 while local development works.

The client detects this case and reports it as `503` with `kind: "challenge"`
and the `cf-ray` id, instead of a bare `403`. Other upstream failures surface as
`502` with the real status and body. Throttling (`429`), upstream `5xx` and
transport errors are retried three times with exponential backoff; challenges
and other `4xx` are not retried, since a retry cannot change the outcome.

If a deployment is being challenged, the fix is infrastructure — egress from a
less-suspect IP, or arrange legitimate API access with Kesko. Defeating the
challenge itself is out of scope for this repo.

## Deploys

Source is bind-mounted into the containers, so changing a file does **not**
change the compose service definition — `docker compose up -d` reports
`Running` and leaves the old container, still executing the code it loaded at
startup, in place. New code silently never runs.

Each service therefore takes `GIT_TAGS`, which DollarDeploy updates to the
current commit on every deploy. The changed definition forces a recreate.

To force one by hand on the host:

```bash
docker compose -p k-ruoka-scraper up -d --force-recreate
```

The health probe hits `/` by default (`APP_HEALTHCHECK_PATH`). Both the API and
the MCP server answer `/` and `/health` with 200 without touching Redis.
