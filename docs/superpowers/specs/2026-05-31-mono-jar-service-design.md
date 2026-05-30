# Mono Jar Live Dashboard — Design Spec

**Date:** 2026-05-31
**Status:** Approved

---

## Overview

A backend service that proxies Monobank API calls, caches jar data in memory, and streams real-time transaction updates to connected browsers over WebSocket. The existing `mono-jar-dashboard.html` becomes the frontend, adapted to connect to this service instead of calling Monobank directly.

**Why a backend?** Monobank has a 1-minute API rate limit. All browser clients share one backend cache — 10 open tabs still means one Monobank call per minute.

---

## Architecture

```
Monobank API ←── polling 60s ──┐
                                ├── Cache (RAM) ──→ WebSocket ──→ Browser(s)
Monobank ──→ POST /webhook ────┘
                                     ↑
                             GET /api/* (cache reads)
                                     ↑
                               Browser polling 60s
```

Two independent data sources (poller + webhook) write to a single in-memory cache. Both also call `ws.broadcast()` directly when they add a new transaction (Option A — direct coupling). Deduplication is owned by the cache via transaction ID.

Browsers use two parallel mechanisms:
- **WebSocket** — instant push for real-time feel
- **HTTP polling every 60s** — resilience; keeps data fresh if WS is disconnected

Neither mechanism ever calls Monobank directly.

---

## Stack

- **Backend:** Node.js 20 + Express + TypeScript + `ws`
- **Frontend:** Vanilla HTML/CSS/JS (single file, adapted from `mono-jar-dashboard.html`)
- **Deploy:** Docker Compose on Synology DS720+
- **CI:** GitHub Actions → build + push to `ghcr.io`
- **CD:** Manual — `docker compose pull && docker compose up -d` on Synology

---

## Project Structure

```
mono-jar/
├── src/
│   ├── server.ts        — entry point, wires all modules
│   ├── mono.ts          — types + Monobank HTTP client
│   ├── cache.ts         — in-memory store + dedup logic
│   ├── webhook.ts       — POST /webhook handler
│   ├── poller.ts        — background polling loop
│   └── ws.ts            — WebSocket broadcaster
├── public/
│   └── index.html       — adapted dashboard (no token form)
├── .github/
│   └── workflows/
│       └── build.yml    — build + push to GHCR on push to main
├── package.json
├── tsconfig.json
├── .env
├── .env.example
├── Dockerfile
└── docker-compose.yml
```

---

## Environment Variables

```
MONO_TOKEN=xxxx
JAR_ID=xxxx
PORT=3000
POLL_INTERVAL_MS=60000
```

---

## Types (`mono.ts`)

```typescript
interface JarInfo {
  id: string
  sendId: string
  title: string
  balance: number
  goal?: number
  currencyCode: number
}

interface Transaction {
  id: string
  time: number
  amount: number
  description: string
  balance: number
}

interface WebhookPayload {
  type: 'StatementItem'
  data: {
    account: string
    statementItem: Transaction
  }
}
```

`fetchJarInfo(token, jarId): Promise<JarInfo>` and `fetchTransactions(token, jarId, fromTs, toTs): Promise<Transaction[]>` throw typed errors on non-200 and 429.

---

## Module Interfaces

### `cache.ts`

```typescript
class Cache {
  getJar(): JarInfo | null
  updateJar(jar: JarInfo): void
  addTransaction(tx: Transaction): boolean  // true = new, false = duplicate
  getTransactions(limit?: number): Transaction[]  // sorted desc, default 100
  getLastTransactionTime(): number | null    // null if cache is empty
}
```

Max 200 transactions in memory. Deduplication by `tx.id`. On server restart, poller reseeds from Monobank.

### `poller.ts`

```typescript
startPoller(cache: Cache, broadcast: (tx: Transaction, jar: JarInfo) => void): void
```

- First tick: fetches last 3 hours (`now - 10800s`)
- Subsequent ticks: fetches from `lastTxTime - 10s` to now (10s overlap to avoid gaps); if cache is still empty after first tick, falls back to `now - 70s`
- After each statement fetch: calls `fetchJarInfo` to refresh balance/goal in cache
- 429: skip tick, retry next interval
- Other errors: log to console, never crash the process

### `webhook.ts`

```typescript
createWebhookHandler(
  cache: Cache,
  broadcast: (tx: Transaction, jar: JarInfo) => void
): RequestHandler
```

- Validates `data.account === JAR_ID`
- Calls `cache.addTransaction()` → if `true`, calls `broadcast()`
- Always responds 200 within 5s (Monobank requirement)
- No signature validation (private home server, security by obscurity is acceptable)

### `ws.ts`

```typescript
createWsServer(server: http.Server, cache: Cache): {
  broadcast(tx: Transaction, jar: JarInfo): void
}
```

- On client connect: sends `{ type: 'init', jar: JarInfo, transactions: Transaction[] }`
- On `broadcast()`: sends `{ type: 'transaction', data: Transaction, jar: { balance, goal? } }` to all clients
- Ping every 30s; drops client after 2 consecutive missed pongs

### `server.ts`

Instantiates `Cache`, creates Express app, mounts webhook handler and API routes, starts `http.Server`, creates WS server, starts poller — passing `wsServer.broadcast` to both poller and webhook handler.

---

## HTTP Endpoints

```
GET  /                  → serve public/index.html
GET  /api/jar           → { title, balance, goal? } from cache
GET  /api/transactions  → last 100 transactions from cache
POST /webhook           → Mono push handler
GET  /ws                → WebSocket upgrade
```

---

## WebSocket Protocol

**Server → client:**
```typescript
{ type: 'init', jar: JarInfo, transactions: Transaction[] }
{ type: 'transaction', data: Transaction, jar: { balance: number, goal?: number } }
{ type: 'ping' }
```

**Client → server:**
```typescript
{ type: 'pong' }
```

---

## Frontend (`public/index.html`)

Based on `mono-jar-dashboard.html`. Visual design, typography, and color palette are unchanged.

**Removed:** setup screen (token/jar form), all direct Monobank API calls, localStorage credential storage.

**Added — two parallel loops:**

```
page load
  → GET /api/transactions  (render immediately, no spinner)
  → GET /api/jar           (jar name, balance, goal bar)
  → open WebSocket /ws
      'init'        → sync any txs not yet in knownIds, update jar info
      'transaction' → prepend feed + toast + update stats
      'ping'        → reply { type: 'pong' }
      disconnect    → status yellow "reconnecting...", retry every 3s
                      after 10s no connection → status red "офлайн"

  setInterval 60s → GET /api/transactions → add new txs (knownIds dedup)
                  → GET /api/jar          → refresh balance/goal
```

**Connection status states:**
- 🟢 `live` — WebSocket connected
- 🟡 `reconnecting` — WS dropped, retrying
- 🔴 `error` — no connection >10s

---

## Docker

**Dockerfile** — multi-stage build:
- Stage 1 (`builder`): `node:20-alpine`, install deps, compile TypeScript → `dist/`
- Stage 2: copy `dist/` + `public/` + production deps only

**`docker-compose.yml`:**
```yaml
services:
  mono-jar:
    image: ghcr.io/OWNER/mono-jar:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file: .env
    volumes:
      - ./logs:/app/logs
```

**`.github/workflows/build.yml`:**
- Trigger: push to `main`
- Steps: checkout → setup Docker Buildx → login to GHCR → build + push `ghcr.io/OWNER/mono-jar:latest`

---

## Manual Deploy (Synology)

```bash
docker compose pull && docker compose up -d
```

Synology reverse proxy handles HTTPS. Webhook registration is a one-time step after first deploy:

```bash
curl -X POST https://api.monobank.ua/personal/webhook \
  -H "X-Token: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"webHookUrl": "https://your-domain.synology.me/webhook"}'
```

---

## What's Excluded

- Database — all state in memory; poller reseeds on restart
- Auth on frontend — dashboard is private by network access
- HTTPS on app — handled by Synology reverse proxy
- Rate limiting middleware — private server, not needed
- Automated CD — manual pull on Synology is sufficient
