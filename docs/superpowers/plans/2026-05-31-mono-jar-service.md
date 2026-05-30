# Mono Jar Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js/TypeScript backend that proxies Monobank API calls, deduplicates transactions in an in-memory cache, and pushes real-time updates to browser clients over WebSocket — with HTTP polling as a parallel resilience layer.

**Architecture:** Monobank webhook and a 60s poller both write to a single `Cache` instance (dedup by transaction ID). Both call `ws.broadcast()` directly on new transactions. Browser clients connect via WebSocket for instant push and also poll `GET /api/transactions` every 60s independently — neither mechanism ever calls Monobank.

**Tech Stack:** Node.js 20, Express 4, TypeScript 5, `ws` 8, Jest + ts-jest + supertest, Docker, GitHub Actions → GHCR

---

## File Map

| File | Role |
|------|------|
| `src/mono.ts` | Types (`JarInfo`, `Transaction`, `WebhookPayload`) + `fetchJarInfo` + `fetchTransactions` |
| `src/cache.ts` | `Cache` class — dedup by tx ID, max 200, sorted desc |
| `src/webhook.ts` | `createWebhookHandler(cache, broadcast)` — Express route factory |
| `src/poller.ts` | `startPoller(cache, broadcast)` — 60s background loop |
| `src/ws.ts` | `createWsServer(server, cache)` — WebSocket broadcaster + ping/pong |
| `src/server.ts` | Wires all modules, exports `{ app, cache }` for tests, guarded `main()` |
| `public/index.html` | Adapted `mono-jar-dashboard.html` — no token form, WS + HTTP polling |
| `tests/mono.test.ts` | Unit tests for HTTP client |
| `tests/cache.test.ts` | Unit tests for Cache |
| `tests/webhook.test.ts` | Integration tests via supertest |
| `tests/poller.test.ts` | Unit tests with mocked mono module |
| `tests/ws.test.ts` | Integration tests with real server + ws client |
| `tests/server.test.ts` | API route tests via supertest |
| `Dockerfile` | Multi-stage build |
| `docker-compose.yml` | Synology deploy config |
| `.github/workflows/build.yml` | CI: build + push to GHCR |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mono-jar",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "dev": "ts-node-dev --respawn src/server.ts",
    "start": "node dist/server.js",
    "test": "jest"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.18.3",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.11.0",
    "@types/supertest": "^6.0.2",
    "@types/ws": "^8.5.10",
    "jest": "^29.7.0",
    "supertest": "^6.3.4",
    "ts-jest": "^29.1.2",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.3.3"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "testMatch": ["**/tests/**/*.test.ts"],
    "setupFiles": ["<rootDir>/tests/setup.ts"]
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
.env
logs/
*.iml
.idea/
```

- [ ] **Step 4: Create `.env.example`**

```
MONO_TOKEN=your_token_here
JAR_ID=your_jar_id_here
PORT=3000
POLL_INTERVAL_MS=60000
```

- [ ] **Step 5: Create `tests/setup.ts`** (sets env vars before all tests)

```typescript
process.env.MONO_TOKEN = 'test-token'
process.env.JAR_ID = 'jar1'
process.env.PORT = '3001'
process.env.POLL_INTERVAL_MS = '60000'
```

- [ ] **Step 6: Create `src/` and `public/` and `tests/` directories, then install dependencies**

```bash
mkdir -p src public tests
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Verify TypeScript compiles (no source yet — just confirm tsc is available)**

```bash
npx tsc --version
```

Expected output: `Version 5.x.x`

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example tests/setup.ts package-lock.json
git commit -m "feat: project scaffolding — package.json, tsconfig, jest config"
```

---

## Task 2: `src/mono.ts` — Types + HTTP Client

**Files:**
- Create: `src/mono.ts`
- Create: `tests/mono.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/mono.test.ts`:

```typescript
import { fetchJarInfo, fetchTransactions } from '../src/mono'

function mockFetch(status: number, body: unknown): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  }) as unknown as typeof fetch
}

afterEach(() => jest.restoreAllMocks())

describe('fetchJarInfo', () => {
  const jar = { id: 'jar1', sendId: 's1', title: 'Test', balance: 5000, currencyCode: 980 }

  it('returns jar matching by id', async () => {
    mockFetch(200, { jars: [jar] })
    expect(await fetchJarInfo('token', 'jar1')).toEqual(jar)
  })

  it('returns jar matching by sendId', async () => {
    mockFetch(200, { jars: [jar] })
    expect(await fetchJarInfo('token', 's1')).toEqual(jar)
  })

  it('throws RATE_LIMIT on 429', async () => {
    mockFetch(429, {})
    await expect(fetchJarInfo('token', 'jar1')).rejects.toThrow('RATE_LIMIT')
  })

  it('throws HTTP error on non-200', async () => {
    mockFetch(401, {})
    await expect(fetchJarInfo('token', 'jar1')).rejects.toThrow('HTTP 401')
  })

  it('throws JAR_NOT_FOUND when jar absent', async () => {
    mockFetch(200, { jars: [] })
    await expect(fetchJarInfo('token', 'jar1')).rejects.toThrow('JAR_NOT_FOUND')
  })
})

describe('fetchTransactions', () => {
  const tx = { id: 'tx1', time: 1000, amount: 100, description: 'test', balance: 1000 }

  it('returns array of transactions', async () => {
    mockFetch(200, [tx])
    expect(await fetchTransactions('token', 'jar1', 0, 1000)).toEqual([tx])
  })

  it('returns empty array for non-array response', async () => {
    mockFetch(200, null)
    expect(await fetchTransactions('token', 'jar1', 0, 1000)).toEqual([])
  })

  it('throws RATE_LIMIT on 429', async () => {
    mockFetch(429, {})
    await expect(fetchTransactions('token', 'jar1', 0, 1000)).rejects.toThrow('RATE_LIMIT')
  })
})
```

- [ ] **Step 2: Run tests — expect failure (module not found)**

```bash
npx jest tests/mono.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../src/mono'`

- [ ] **Step 3: Create `src/mono.ts`**

```typescript
const BASE = 'https://api.monobank.ua'

export interface JarInfo {
  id: string
  sendId: string
  title: string
  balance: number
  goal?: number
  currencyCode: number
}

export interface Transaction {
  id: string
  time: number
  amount: number
  description: string
  balance: number
}

export interface WebhookPayload {
  type: 'StatementItem'
  data: {
    account: string
    statementItem: Transaction
  }
}

export async function fetchJarInfo(token: string, jarId: string): Promise<JarInfo> {
  const res = await fetch(`${BASE}/personal/client-info`, {
    headers: { 'X-Token': token },
  })
  if (res.status === 429) throw new Error('RATE_LIMIT')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json() as { jars?: JarInfo[] }
  const jar = (data.jars ?? []).find(j => j.id === jarId || j.sendId === jarId)
  if (!jar) throw new Error('JAR_NOT_FOUND')
  return jar
}

export async function fetchTransactions(
  token: string,
  jarId: string,
  fromTs: number,
  toTs: number,
): Promise<Transaction[]> {
  const res = await fetch(`${BASE}/personal/statement/${jarId}/${fromTs}/${toTs}`, {
    headers: { 'X-Token': token },
  })
  if (res.status === 429) throw new Error('RATE_LIMIT')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? data as Transaction[] : []
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
npx jest tests/mono.test.ts --no-coverage
```

Expected: PASS — 8 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/mono.ts tests/mono.test.ts
git commit -m "feat: mono.ts — types and Monobank HTTP client"
```

---

## Task 3: `src/cache.ts` — In-Memory Store

**Files:**
- Create: `src/cache.ts`
- Create: `tests/cache.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/cache.test.ts`:

```typescript
import { Cache } from '../src/cache'
import { Transaction, JarInfo } from '../src/mono'

const makeTx = (id: string, time: number, amount = 100): Transaction => ({
  id, time, amount, description: 'test', balance: 1000,
})

const jar: JarInfo = { id: 'jar1', sendId: 's1', title: 'Test', balance: 5000, currencyCode: 980 }

describe('Cache', () => {
  let cache: Cache
  beforeEach(() => { cache = new Cache() })

  describe('addTransaction', () => {
    it('returns true for new transaction', () => {
      expect(cache.addTransaction(makeTx('tx1', 1000))).toBe(true)
    })

    it('returns false for duplicate', () => {
      cache.addTransaction(makeTx('tx1', 1000))
      expect(cache.addTransaction(makeTx('tx1', 1000))).toBe(false)
    })

    it('keeps transactions sorted desc by time', () => {
      cache.addTransaction(makeTx('tx1', 1000))
      cache.addTransaction(makeTx('tx2', 3000))
      cache.addTransaction(makeTx('tx3', 2000))
      const txs = cache.getTransactions()
      expect(txs.map(t => t.id)).toEqual(['tx2', 'tx3', 'tx1'])
    })

    it('evicts oldest when exceeding 200', () => {
      for (let i = 0; i < 201; i++) cache.addTransaction(makeTx(`tx${i}`, i))
      expect(cache.getTransactions(300).length).toBe(200)
      expect(cache.getTransactions(300).find(t => t.id === 'tx0')).toBeUndefined()
    })
  })

  describe('getTransactions', () => {
    it('returns empty array initially', () => {
      expect(cache.getTransactions()).toEqual([])
    })

    it('respects limit, defaults to 100', () => {
      for (let i = 0; i < 150; i++) cache.addTransaction(makeTx(`tx${i}`, i))
      expect(cache.getTransactions().length).toBe(100)
      expect(cache.getTransactions(50).length).toBe(50)
    })
  })

  describe('getLastTransactionTime', () => {
    it('returns null when empty', () => {
      expect(cache.getLastTransactionTime()).toBeNull()
    })

    it('returns time of most recent transaction', () => {
      cache.addTransaction(makeTx('tx1', 1000))
      cache.addTransaction(makeTx('tx2', 3000))
      expect(cache.getLastTransactionTime()).toBe(3000)
    })
  })

  describe('jar', () => {
    it('returns null initially', () => {
      expect(cache.getJar()).toBeNull()
    })

    it('returns jar after updateJar', () => {
      cache.updateJar(jar)
      expect(cache.getJar()).toEqual(jar)
    })
  })

  describe('clear', () => {
    it('resets all state', () => {
      cache.updateJar(jar)
      cache.addTransaction(makeTx('tx1', 1000))
      cache.clear()
      expect(cache.getJar()).toBeNull()
      expect(cache.getTransactions()).toEqual([])
      expect(cache.getLastTransactionTime()).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
npx jest tests/cache.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../src/cache'`

- [ ] **Step 3: Create `src/cache.ts`**

```typescript
import { JarInfo, Transaction } from './mono'

const MAX = 200

export class Cache {
  private jar: JarInfo | null = null
  private transactions: Transaction[] = []
  private ids = new Set<string>()

  getJar(): JarInfo | null { return this.jar }

  updateJar(jar: JarInfo): void { this.jar = jar }

  addTransaction(tx: Transaction): boolean {
    if (this.ids.has(tx.id)) return false
    this.ids.add(tx.id)
    this.transactions.push(tx)
    this.transactions.sort((a, b) => b.time - a.time)
    if (this.transactions.length > MAX) {
      const evicted = this.transactions.splice(MAX)
      evicted.forEach(t => this.ids.delete(t.id))
    }
    return true
  }

  getTransactions(limit = 100): Transaction[] {
    return this.transactions.slice(0, limit)
  }

  getLastTransactionTime(): number | null {
    return this.transactions.length > 0 ? this.transactions[0].time : null
  }

  clear(): void {
    this.jar = null
    this.transactions = []
    this.ids = new Set()
  }
}
```

- [ ] **Step 4: Run — expect all pass**

```bash
npx jest tests/cache.test.ts --no-coverage
```

Expected: PASS — 10 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/cache.ts tests/cache.test.ts
git commit -m "feat: cache.ts — in-memory store with dedup and eviction"
```

---

## Task 4: `src/webhook.ts` — Webhook Handler

**Files:**
- Create: `src/webhook.ts`
- Create: `tests/webhook.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/webhook.test.ts`:

```typescript
import express from 'express'
import request from 'supertest'
import { createWebhookHandler } from '../src/webhook'
import { Cache } from '../src/cache'
import { JarInfo, Transaction } from '../src/mono'

const jar: JarInfo = { id: 'jar1', sendId: 's1', title: 'Test', balance: 5000, currencyCode: 980 }

const validPayload = {
  type: 'StatementItem',
  data: {
    account: 'jar1',
    statementItem: { id: 'tx1', time: 1000, amount: 100, description: 'Donation', balance: 5100 },
  },
}

function makeApp(cache: Cache, broadcast: jest.Mock) {
  const app = express()
  app.use(express.json())
  app.post('/webhook', createWebhookHandler(cache, broadcast))
  return app
}

describe('createWebhookHandler', () => {
  let cache: Cache
  let broadcast: jest.Mock

  beforeEach(() => {
    cache = new Cache()
    cache.updateJar(jar)
    broadcast = jest.fn()
  })

  it('responds 200 for valid payload', async () => {
    await request(makeApp(cache, broadcast)).post('/webhook').send(validPayload).expect(200)
  })

  it('calls broadcast with new transaction and updated jar', async () => {
    await request(makeApp(cache, broadcast)).post('/webhook').send(validPayload)
    expect(broadcast).toHaveBeenCalledTimes(1)
    const [broadcastTx, broadcastJar] = broadcast.mock.calls[0]
    expect(broadcastTx.id).toBe('tx1')
    expect(broadcastJar.balance).toBe(5100)
  })

  it('does not broadcast duplicate transaction', async () => {
    cache.addTransaction(validPayload.data.statementItem as Transaction)
    await request(makeApp(cache, broadcast)).post('/webhook').send(validPayload)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('ignores non-StatementItem type', async () => {
    await request(makeApp(cache, broadcast)).post('/webhook')
      .send({ type: 'Other', data: {} }).expect(200)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('ignores wrong account', async () => {
    const payload = { ...validPayload, data: { ...validPayload.data, account: 'other' } }
    await request(makeApp(cache, broadcast)).post('/webhook').send(payload).expect(200)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('ignores negative amounts', async () => {
    const payload = {
      ...validPayload,
      data: { ...validPayload.data, statementItem: { ...validPayload.data.statementItem, amount: -100 } },
    }
    await request(makeApp(cache, broadcast)).post('/webhook').send(payload).expect(200)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('ignores zero amounts', async () => {
    const payload = {
      ...validPayload,
      data: { ...validPayload.data, statementItem: { ...validPayload.data.statementItem, amount: 0 } },
    }
    await request(makeApp(cache, broadcast)).post('/webhook').send(payload).expect(200)
    expect(broadcast).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
npx jest tests/webhook.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../src/webhook'`

- [ ] **Step 3: Create `src/webhook.ts`**

```typescript
import { RequestHandler } from 'express'
import { JarInfo, Transaction, WebhookPayload } from './mono'
import { Cache } from './cache'

export function createWebhookHandler(
  cache: Cache,
  broadcast: (tx: Transaction, jar: JarInfo) => void,
): RequestHandler {
  const jarId = process.env.JAR_ID!

  return (req, res) => {
    res.sendStatus(200)

    const payload = req.body as WebhookPayload
    if (payload?.type !== 'StatementItem') return
    if (payload.data?.account !== jarId) return

    const tx = payload.data.statementItem
    if (!tx || tx.amount <= 0) return

    if (cache.addTransaction(tx)) {
      const jar = cache.getJar()
      if (jar) {
        const updatedJar = { ...jar, balance: tx.balance }
        cache.updateJar(updatedJar)
        broadcast(tx, updatedJar)
      }
    }
  }
}
```

- [ ] **Step 4: Run — expect all pass**

```bash
npx jest tests/webhook.test.ts --no-coverage
```

Expected: PASS — 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/webhook.ts tests/webhook.test.ts
git commit -m "feat: webhook.ts — Monobank push handler"
```

---

## Task 5: `src/poller.ts` — Background Polling Loop

**Files:**
- Create: `src/poller.ts`
- Create: `tests/poller.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/poller.test.ts`:

```typescript
jest.mock('../src/mono')

import * as mono from '../src/mono'
import { Cache } from '../src/cache'
import { startPoller } from '../src/poller'
import { JarInfo, Transaction } from '../src/mono'

const mockFetchTransactions = mono.fetchTransactions as jest.MockedFunction<typeof mono.fetchTransactions>
const mockFetchJarInfo = mono.fetchJarInfo as jest.MockedFunction<typeof mono.fetchJarInfo>

const flushPromises = () => new Promise<void>(resolve => setImmediate(resolve))

const jar: JarInfo = { id: 'jar1', sendId: 's1', title: 'Test', balance: 5000, currencyCode: 980 }
const tx: Transaction = { id: 'tx1', time: 1000, amount: 100, description: 'test', balance: 5100 }

describe('startPoller', () => {
  let cache: Cache
  let broadcast: jest.Mock

  beforeEach(() => {
    cache = new Cache()
    cache.updateJar(jar)
    broadcast = jest.fn()
    mockFetchTransactions.mockResolvedValue([tx])
    mockFetchJarInfo.mockResolvedValue(jar)
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  it('calls fetchTransactions on first tick', async () => {
    startPoller(cache, broadcast)
    await flushPromises()
    expect(mockFetchTransactions).toHaveBeenCalledTimes(1)
    const [, , from] = mockFetchTransactions.mock.calls[0]
    const now = Math.floor(Date.now() / 1000)
    expect(from).toBeGreaterThanOrEqual(now - 10810)
    expect(from).toBeLessThanOrEqual(now - 10790)
  })

  it('broadcasts incoming transactions on first tick', async () => {
    startPoller(cache, broadcast)
    await flushPromises()
    expect(broadcast).toHaveBeenCalledWith(tx, expect.objectContaining({ id: 'jar1' }))
  })

  it('does not broadcast duplicate transactions', async () => {
    cache.addTransaction(tx)
    startPoller(cache, broadcast)
    await flushPromises()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('skips negative amount transactions', async () => {
    mockFetchTransactions.mockResolvedValue([{ ...tx, amount: -100 }])
    startPoller(cache, broadcast)
    await flushPromises()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('handles RATE_LIMIT without crashing', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation()
    mockFetchTransactions.mockRejectedValue(new Error('RATE_LIMIT'))
    startPoller(cache, broadcast)
    await flushPromises()
    expect(logSpy).toHaveBeenCalledWith('[poller] rate limited, skipping tick')
    expect(broadcast).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('logs and continues on unknown error', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation()
    mockFetchTransactions.mockRejectedValue(new Error('Network failure'))
    startPoller(cache, broadcast)
    await flushPromises()
    expect(errorSpy).toHaveBeenCalledWith('[poller] error:', 'Network failure')
    errorSpy.mockRestore()
  })

  it('uses lastTransactionTime on subsequent ticks', async () => {
    cache.addTransaction({ ...tx, time: 9000 })
    startPoller(cache, broadcast)
    await flushPromises()
    jest.advanceTimersByTime(60000)
    await flushPromises()
    const secondCallFrom = mockFetchTransactions.mock.calls[1][2]
    expect(secondCallFrom).toBe(9000 - 10)
  })

  it('falls back to now-70 on subsequent tick when cache still empty', async () => {
    mockFetchTransactions.mockResolvedValue([])
    mockFetchJarInfo.mockResolvedValue(jar)
    startPoller(cache, broadcast)
    await flushPromises()
    jest.advanceTimersByTime(60000)
    await flushPromises()
    const secondCallFrom = mockFetchTransactions.mock.calls[1][2]
    const now = Math.floor(Date.now() / 1000)
    expect(secondCallFrom).toBeGreaterThanOrEqual(now - 80)
    expect(secondCallFrom).toBeLessThanOrEqual(now - 60)
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
npx jest tests/poller.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../src/poller'`

- [ ] **Step 3: Create `src/poller.ts`**

```typescript
import { fetchJarInfo, fetchTransactions, JarInfo, Transaction } from './mono'
import { Cache } from './cache'

export function startPoller(
  cache: Cache,
  broadcast: (tx: Transaction, jar: JarInfo) => void,
): void {
  const token = process.env.MONO_TOKEN!
  const jarId = process.env.JAR_ID!
  const interval = parseInt(process.env.POLL_INTERVAL_MS ?? '60000', 10)

  let isFirst = true

  async function tick(): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000)
      let from: number

      if (isFirst) {
        from = now - 3 * 3600
        isFirst = false
      } else {
        const lastTime = cache.getLastTransactionTime()
        from = lastTime !== null ? lastTime - 10 : now - 70
      }

      const txs = await fetchTransactions(token, jarId, from, now)
      const incoming = txs.filter(t => t.amount > 0)
      incoming.sort((a, b) => a.time - b.time)

      for (const tx of incoming) {
        if (cache.addTransaction(tx)) {
          const jar = cache.getJar()
          if (jar) broadcast(tx, jar)
        }
      }

      try {
        const jar = await fetchJarInfo(token, jarId)
        cache.updateJar(jar)
      } catch {
        // non-fatal: keep cached jar info
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'RATE_LIMIT') {
        console.log('[poller] rate limited, skipping tick')
      } else {
        console.error('[poller] error:', msg)
      }
    }

    setTimeout(tick, interval)
  }

  tick()
}
```

- [ ] **Step 4: Run — expect all pass**

```bash
npx jest tests/poller.test.ts --no-coverage
```

Expected: PASS — 8 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/poller.ts tests/poller.test.ts
git commit -m "feat: poller.ts — 60s background polling loop"
```

---

## Task 6: `src/ws.ts` — WebSocket Broadcaster

**Files:**
- Create: `src/ws.ts`
- Create: `tests/ws.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/ws.test.ts`:

```typescript
import http from 'http'
import WebSocket from 'ws'
import { AddressInfo } from 'net'
import { Cache } from '../src/cache'
import { createWsServer } from '../src/ws'
import { JarInfo, Transaction } from '../src/mono'

const jar: JarInfo = { id: 'jar1', sendId: 's1', title: 'Test', balance: 5000, currencyCode: 980 }
const tx: Transaction = { id: 'tx1', time: 1000, amount: 100, description: 'test', balance: 5100 }

function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise(resolve => ws.once('message', data => resolve(JSON.parse(data.toString()))))
}

describe('createWsServer', () => {
  let server: http.Server
  let cache: Cache
  let wsServer: ReturnType<typeof createWsServer>
  let port: number

  beforeEach(done => {
    cache = new Cache()
    cache.updateJar(jar)
    server = http.createServer()
    wsServer = createWsServer(server, cache)
    server.listen(0, () => {
      port = (server.address() as AddressInfo).port
      done()
    })
  })

  afterEach(done => server.close(done))

  it('sends init message on connect', async () => {
    const client = new WebSocket(`ws://localhost:${port}/ws`)
    const msg = await waitForMessage(client) as { type: string; jar: JarInfo; transactions: Transaction[] }
    expect(msg.type).toBe('init')
    expect(msg.jar).toEqual(jar)
    expect(msg.transactions).toEqual([])
    client.terminate()
  })

  it('includes cached transactions in init', async () => {
    cache.addTransaction(tx)
    const client = new WebSocket(`ws://localhost:${port}/ws`)
    const msg = await waitForMessage(client) as { transactions: Transaction[] }
    expect(msg.transactions).toHaveLength(1)
    expect(msg.transactions[0].id).toBe('tx1')
    client.terminate()
  })

  it('broadcasts transaction to all connected clients', done => {
    const client = new WebSocket(`ws://localhost:${port}/ws`)
    client.once('open', () => {
      // consume init message
      client.once('message', () => {
        client.once('message', data => {
          const msg = JSON.parse(data.toString())
          expect(msg.type).toBe('transaction')
          expect(msg.data.id).toBe('tx1')
          expect(msg.jar.balance).toBe(5100)
          client.terminate()
          done()
        })
        wsServer.broadcast(tx, { ...jar, balance: 5100 })
      })
    })
  })

  it('replies to ping with pong from client', done => {
    const client = new WebSocket(`ws://localhost:${port}/ws`)
    client.on('message', data => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'ping') {
        client.send(JSON.stringify({ type: 'pong' }))
        client.terminate()
        done()
      }
    })
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
npx jest tests/ws.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../src/ws'`

- [ ] **Step 3: Create `src/ws.ts`**

```typescript
import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { Cache } from './cache'
import { JarInfo, Transaction } from './mono'

const PING_INTERVAL_MS = 30_000

export function createWsServer(
  server: http.Server,
  cache: Cache,
): { broadcast: (tx: Transaction, jar: JarInfo) => void } {
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', ws => {
    let missedPongs = 0

    ws.send(JSON.stringify({
      type: 'init',
      jar: cache.getJar(),
      transactions: cache.getTransactions(),
    }))

    const pingTimer = setInterval(() => {
      if (missedPongs >= 2) {
        ws.terminate()
        return
      }
      missedPongs++
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, PING_INTERVAL_MS)

    ws.on('message', data => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string }
        if (msg.type === 'pong') missedPongs = 0
      } catch {
        // ignore malformed messages
      }
    })

    ws.on('close', () => clearInterval(pingTimer))
    ws.on('error', () => clearInterval(pingTimer))
  })

  return {
    broadcast(tx: Transaction, jar: JarInfo): void {
      const msg = JSON.stringify({
        type: 'transaction',
        data: tx,
        jar: { balance: jar.balance, goal: jar.goal },
      })
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg)
        }
      }
    },
  }
}
```

- [ ] **Step 4: Run — expect all pass**

```bash
npx jest tests/ws.test.ts --no-coverage
```

Expected: PASS — 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/ws.ts tests/ws.test.ts
git commit -m "feat: ws.ts — WebSocket broadcaster with ping/pong"
```

---

## Task 7: `src/server.ts` — Express App + API Routes

**Files:**
- Create: `src/server.ts`
- Create: `tests/server.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server.test.ts`:

```typescript
import request from 'supertest'
import { app, cache } from '../src/server'
import { JarInfo, Transaction } from '../src/mono'

const jar: JarInfo = { id: 'jar1', sendId: 's1', title: 'Test Jar', balance: 15000, goal: 100000, currencyCode: 980 }
const tx: Transaction = { id: 'tx1', time: 1000, amount: 5000, description: 'Donation', balance: 15000 }

beforeEach(() => cache.clear())

describe('GET /api/jar', () => {
  it('returns 503 when jar not loaded', async () => {
    await request(app).get('/api/jar').expect(503)
  })

  it('returns jar info when available', async () => {
    cache.updateJar(jar)
    const res = await request(app).get('/api/jar').expect(200)
    expect(res.body).toEqual({ title: 'Test Jar', balance: 15000, goal: 100000 })
  })

  it('omits goal when not set', async () => {
    const { goal: _goal, ...jarWithoutGoal } = jar
    cache.updateJar(jarWithoutGoal as JarInfo)
    const res = await request(app).get('/api/jar').expect(200)
    expect(res.body.goal).toBeUndefined()
  })
})

describe('GET /api/transactions', () => {
  it('returns empty array initially', async () => {
    const res = await request(app).get('/api/transactions').expect(200)
    expect(res.body).toEqual([])
  })

  it('returns cached transactions', async () => {
    cache.addTransaction(tx)
    const res = await request(app).get('/api/transactions').expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('tx1')
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
npx jest tests/server.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../src/server'`

- [ ] **Step 3: Create `src/server.ts`**

```typescript
import 'dotenv/config'
import http from 'http'
import path from 'path'
import express from 'express'
import { Cache } from './cache'
import { createWebhookHandler } from './webhook'
import { createWsServer } from './ws'
import { startPoller } from './poller'
import { JarInfo, Transaction } from './mono'

export const cache = new Cache()

const _app = express()
_app.use(express.json())

_app.get('/api/jar', (_req, res) => {
  const jar = cache.getJar()
  if (!jar) { res.status(503).json({ error: 'not ready' }); return }
  const body: { title: string; balance: number; goal?: number } = { title: jar.title, balance: jar.balance }
  if (jar.goal !== undefined) body.goal = jar.goal
  res.json(body)
})

_app.get('/api/transactions', (_req, res) => {
  res.json(cache.getTransactions())
})

_app.use(express.static(path.join(__dirname, '..', 'public')))

export const app = _app

if (require.main === module) {
  const httpServer = http.createServer(app)
  const wsServer = createWsServer(httpServer, cache)
  app.post('/webhook', createWebhookHandler(cache, wsServer.broadcast))
  const port = parseInt(process.env.PORT ?? '3000', 10)
  httpServer.listen(port, () => {
    console.log(`[server] listening on :${port}`)
    startPoller(cache, wsServer.broadcast)
  })
}
```

- [ ] **Step 4: Run — expect all pass**

```bash
npx jest tests/server.test.ts --no-coverage
```

Expected: PASS — 5 tests pass

- [ ] **Step 5: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass across all test files

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "feat: server.ts — Express app wiring all modules"
```

---

## Task 8: `public/index.html` — Adapted Frontend

**Files:**
- Create: `public/index.html`

- [ ] **Step 1: Create `public/index.html`**

```html
<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Monobank — Банка</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@400;700;900&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --black: #0a0a0a;
    --white: #f5f2ec;
    --yellow: #f5d547;
    --green: #2dc97e;
    --red: #e84040;
    --gray: #1a1a1a;
    --gray2: #2a2a2a;
    --gray3: #444;
    --muted: #888;
    --font-display: 'Unbounded', sans-serif;
    --font-body: 'Inter', sans-serif;
  }

  body {
    background: var(--black);
    color: var(--white);
    font-family: var(--font-body);
    min-height: 100vh;
    padding: 24px 16px;
  }

  .dashboard { max-width: 600px; margin: 0 auto; }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 32px;
  }

  .jar-name {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 900;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--gray3);
    display: inline-block;
    margin-right: 6px;
    transition: background 0.3s;
  }

  .status-dot.live { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .status-dot.reconnecting { background: var(--yellow); }
  .status-dot.error { background: var(--red); }

  .status-text { font-size: 12px; color: var(--muted); }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 24px;
  }

  .stat-card { background: var(--gray); border-radius: 12px; padding: 16px; }

  .stat-label {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 8px;
  }

  .stat-value { font-family: var(--font-display); font-size: 20px; font-weight: 700; line-height: 1; }
  .stat-value.green { color: var(--green); }

  .progress-section { background: var(--gray); border-radius: 12px; padding: 20px; margin-bottom: 24px; }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 12px;
  }

  .progress-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .progress-pct { font-family: var(--font-display); font-size: 20px; font-weight: 900; color: var(--yellow); }

  .progress-bar-bg {
    height: 6px;
    background: var(--gray2);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--yellow);
    border-radius: 3px;
    transition: width 0.6s ease;
    width: 0%;
  }

  .progress-amounts { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); }
  .progress-amounts span:first-child { color: var(--white); font-weight: 500; }

  .feed-header {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 12px;
  }

  .feed { display: flex; flex-direction: column; gap: 8px; }

  .feed-item {
    background: var(--gray);
    border-radius: 10px;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    animation: slide-in 0.3s ease;
    border-left: 3px solid transparent;
  }

  .feed-item.new { border-left-color: var(--green); }

  @keyframes slide-in {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .feed-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--gray2);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    flex-shrink: 0;
    color: var(--yellow);
    font-family: var(--font-display);
  }

  .feed-info { flex: 1; min-width: 0; }

  .feed-desc {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 2px;
  }

  .feed-time { font-size: 11px; color: var(--muted); }

  .feed-amount {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 700;
    color: var(--green);
    white-space: nowrap;
  }

  .feed-empty {
    text-align: center;
    padding: 48px 0;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.7;
  }

  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(80px);
    background: var(--green);
    color: var(--black);
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 700;
    padding: 12px 24px;
    border-radius: 100px;
    transition: transform 0.3s ease;
    pointer-events: none;
    white-space: nowrap;
    z-index: 100;
  }

  .toast.show { transform: translateX(-50%) translateY(0); }

  @media (max-width: 400px) {
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
    .stat-value { font-size: 16px; }
    .jar-name { font-size: 14px; }
  }
</style>
</head>
<body>

<div class="dashboard" id="dashboard">
  <div class="top-bar">
    <div class="jar-name" id="dash-name">Банка</div>
    <div>
      <span class="status-dot" id="status-dot"></span>
      <span class="status-text" id="status-text">підключення...</span>
    </div>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Зібрано</div>
      <div class="stat-value green" id="stat-balance">—</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Платежів</div>
      <div class="stat-value" id="stat-count">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Середній</div>
      <div class="stat-value" id="stat-avg">—</div>
    </div>
  </div>

  <div class="progress-section" id="progress-section" style="display:none">
    <div class="progress-header">
      <span class="progress-label">Прогрес до мети</span>
      <span class="progress-pct" id="progress-pct">0%</span>
    </div>
    <div class="progress-bar-bg">
      <div class="progress-bar-fill" id="progress-bar"></div>
    </div>
    <div class="progress-amounts">
      <span id="prog-balance">0 ₴</span>
      <span id="prog-goal">—</span>
    </div>
  </div>

  <div class="feed-header">Останні надходження</div>
  <div class="feed" id="feed">
    <div class="feed-empty">Завантаження...</div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
let jarInfo = null;
const knownIds = new Set();
let totalCount = 0;
let totalSum = 0;
let wsReconnectTimer = null;
let wsOfflineTimer = null;

const $ = id => document.getElementById(id);

function fmt(kopecks) {
  const uah = kopecks / 100;
  return uah.toLocaleString('uk-UA', { style: 'currency', currency: 'UAH', maximumFractionDigits: uah % 1 === 0 ? 0 : 2 });
}

function timeAgo(ts) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'щойно';
  if (diff < 3600) return Math.floor(diff / 60) + ' хв тому';
  if (diff < 86400) return Math.floor(diff / 3600) + ' год тому';
  return new Date(ts * 1000).toLocaleDateString('uk-UA');
}

function initials(desc) {
  if (!desc) return '?';
  const words = desc.replace(/від:/gi, '').trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] || '?')[0].toUpperCase();
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function setStatus(state, text) {
  $('status-dot').className = 'status-dot ' + state;
  $('status-text').textContent = text;
}

function updateStats() {
  const balance = jarInfo?.balance ?? totalSum;
  $('stat-balance').textContent = fmt(balance);
  $('stat-count').textContent = totalCount;
  $('stat-avg').textContent = totalCount > 0 ? fmt(Math.round(totalSum / totalCount)) : '—';

  if (jarInfo?.goal) {
    const pct = Math.min(100, Math.round((balance / jarInfo.goal) * 100));
    $('progress-section').style.display = 'block';
    $('progress-pct').textContent = pct + '%';
    $('progress-bar').style.width = pct + '%';
    $('prog-balance').textContent = fmt(balance);
    $('prog-goal').textContent = fmt(jarInfo.goal);
  }
}

function addTransaction(tx, isNew = false) {
  if (knownIds.has(tx.id)) return false;
  knownIds.add(tx.id);

  const feed = $('feed');
  const empty = feed.querySelector('.feed-empty');
  if (empty) empty.remove();

  totalCount++;
  totalSum += tx.amount;

  const item = document.createElement('div');
  item.className = 'feed-item' + (isNew ? ' new' : '');
  const desc = tx.description || 'Поповнення';
  item.innerHTML = `
    <div class="feed-avatar">${initials(desc)}</div>
    <div class="feed-info">
      <div class="feed-desc">${desc}</div>
      <div class="feed-time">${timeAgo(tx.time)}</div>
    </div>
    <div class="feed-amount">+${fmt(tx.amount)}</div>
  `;
  feed.insertBefore(item, feed.firstChild);
  if (feed.children.length > 50) feed.removeChild(feed.lastChild);
  if (isNew) setTimeout(() => item.classList.remove('new'), 4000);
  return true;
}

async function loadInitialData() {
  try {
    const [txRes, jarRes] = await Promise.all([fetch('/api/transactions'), fetch('/api/jar')]);
    if (!txRes.ok || !jarRes.ok) return;
    const txs = await txRes.json();
    jarInfo = await jarRes.json();
    $('dash-name').textContent = jarInfo.title || 'Банка';
    txs.sort((a, b) => a.time - b.time);
    txs.forEach(tx => addTransaction(tx, false));
    updateStats();
  } catch (e) {
    console.error('[init] failed to load data', e);
  }
}

async function pollData() {
  try {
    const [txRes, jarRes] = await Promise.all([fetch('/api/transactions'), fetch('/api/jar')]);
    if (!txRes.ok || !jarRes.ok) return;
    const txs = await txRes.json();
    const newJar = await jarRes.json();
    jarInfo = newJar;

    let newCount = 0;
    txs.sort((a, b) => b.time - a.time);
    txs.forEach(tx => { if (addTransaction(tx, true)) newCount++; });
    if (newCount > 0) updateStats();

    $('stat-balance').textContent = fmt(jarInfo.balance);
    if (jarInfo.goal) {
      const pct = Math.min(100, Math.round((jarInfo.balance / jarInfo.goal) * 100));
      $('progress-section').style.display = 'block';
      $('progress-pct').textContent = pct + '%';
      $('progress-bar').style.width = pct + '%';
      $('prog-balance').textContent = fmt(jarInfo.balance);
    }
  } catch (e) {
    console.error('[poll] failed', e);
  }
}

function connectWs() {
  clearTimeout(wsReconnectTimer);
  clearTimeout(wsOfflineTimer);

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    setStatus('live', 'онлайн');
    clearTimeout(wsOfflineTimer);
  };

  ws.onmessage = e => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (msg.type === 'init') {
      if (msg.jar) {
        jarInfo = msg.jar;
        $('dash-name').textContent = jarInfo.title || 'Банка';
      }
      (msg.transactions || []).sort((a, b) => a.time - b.time);
      (msg.transactions || []).forEach(tx => addTransaction(tx, false));
      updateStats();
      return;
    }

    if (msg.type === 'transaction') {
      if (addTransaction(msg.data, true)) {
        jarInfo = { ...jarInfo, ...msg.jar };
        updateStats();
        showToast(`+ ${fmt(msg.data.amount)}`);
      }
    }
  };

  ws.onclose = () => {
    setStatus('reconnecting', 'перепідключення...');
    wsOfflineTimer = setTimeout(() => setStatus('error', 'офлайн'), 10000);
    wsReconnectTimer = setTimeout(connectWs, 3000);
  };

  ws.onerror = () => ws.close();
}

loadInitialData().then(() => {
  connectWs();
  setInterval(pollData, 60000);
});
</script>
</body>
</html>
```

- [ ] **Step 2: Build and run locally to verify UI**

```bash
npm run build && node dist/server.js
```

Open `http://localhost:3000` — should show the dashboard loading state. Server will show `[server] listening on :3000`.

(Requires a valid `.env` file. If no `.env`, server will still start but poller will fail with auth errors — that's expected.)

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: public/index.html — dashboard with WS + HTTP polling"
```

---

## Task 9: Docker + GitHub Actions CI

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.github/workflows/build.yml`

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY public ./public
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

- [ ] **Step 2: Create `docker-compose.yml`** (replace `OWNER` with your GitHub username)

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

- [ ] **Step 3: Create `.github/workflows/build.yml`**

```yaml
name: Build and push Docker image

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ghcr.io/${{ github.repository_owner }}/mono-jar:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 4: Verify Docker build locally**

```bash
docker build -t mono-jar:local .
```

Expected: multi-stage build completes, image created. Final image size should be ~150–200MB.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .github/workflows/build.yml
git commit -m "feat: Docker + GitHub Actions CI for GHCR"
```

---

## Task 10: Smoke Test

- [ ] **Step 1: Run full test suite one final time**

```bash
npx jest --no-coverage
```

Expected: all tests pass, no failures.

- [ ] **Step 2: Build TypeScript**

```bash
npm run build
```

Expected: `dist/` directory created, no TypeScript errors.

- [ ] **Step 3: Create `.env` from example and start the server**

```bash
cp .env.example .env
# Edit .env with real MONO_TOKEN and JAR_ID
node dist/server.js
```

Expected:
```
[server] listening on :3000
```

- [ ] **Step 4: Verify API endpoints**

```bash
curl http://localhost:3000/api/jar
curl http://localhost:3000/api/transactions
```

Expected: JSON responses (503 on `/api/jar` until first poller tick completes ~1 min after start; `[]` on `/api/transactions`).

- [ ] **Step 5: Register webhook with Monobank (one-time, after public URL is ready)**

```bash
curl -X POST https://api.monobank.ua/personal/webhook \
  -H "X-Token: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"webHookUrl": "https://your-domain.synology.me/webhook"}'
```

Expected: `{"status":"ok"}` — Monobank will now push to your server.

- [ ] **Step 6: Manual deploy to Synology (after pushing to GitHub and image is built)**

```bash
docker compose pull && docker compose up -d
```

Expected: container starts, `docker compose logs -f` shows `[server] listening on :3000`.
