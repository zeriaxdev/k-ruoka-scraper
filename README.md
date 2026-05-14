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

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API server port |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `REFRESH_INTERVAL_MS` | `3600000` | Scheduler refresh interval (ms) |

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
