Оновлюю розділ про fallback polling — він стає повноцінним паралельним процесом, а не fallback.

---

## Завдання: Mono Jar Live Dashboard

### Архітектура
```
Monobank API ←── polling 60s ──┐
                                ├── Cache (RAM) ──→ WebSocket ──→ Browser
Monobank ──→ POST /webhook ────┘
```

Два незалежних джерела даних працюють паралельно і пишуть в один кеш. Вебхук дає миттєву реакцію, polling — гарантію що нічого не пропустимо якщо вебхук тимчасово не спрацював.

### Стек
- **Backend**: Node.js + Express + TypeScript + `ws` + `express-rate-limit`
- **Frontend**: Vanilla HTML/CSS/JS (один файл)
- **Deploy**: Docker Compose для Synology DS720+

### Структура проєкту
```
mono-jar/
├── src/
│   ├── server.ts
│   ├── mono.ts          — типи і HTTP клієнт до Mono API
│   ├── cache.ts         — in-memory кеш + dedup логіка
│   ├── webhook.ts       — обробка вебхуку від Mono
│   ├── poller.ts        — фоновий polling кожні 60 сек
│   └── ws.ts            — WebSocket broadcaster
├── public/
│   └── index.html
├── package.json
├── tsconfig.json
├── .env
├── .env.example
├── Dockerfile
└── docker-compose.yml
```

### Змінні середовища (.env)
```
MONO_TOKEN=xxxx
JAR_ID=xxxx
PORT=3000
POLL_INTERVAL_MS=60000
```

### Типи (mono.ts)
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

### Backend — ендпоінти

```
GET  /api/jar           — назва, баланс, мета (з кешу)
GET  /api/transactions  — останні 100 транзакцій (з кешу)
POST /webhook           — Mono вебхук
GET  /ws                — WebSocket upgrade
GET  /                  — public/index.html
```

### cache.ts — центральний стор

Єдине місце куди пишуть і вебхук і polling. Містить логіку дедуплікації:

```typescript
class Cache {
  jarInfo: JarInfo | null = null
  transactions: Transaction[] = []   // max 200, sorted desc by time
  
  // Повертає true якщо транзакція нова (не була в кеші)
  // Використовується і вебхуком і поллером
  addTransaction(tx: Transaction): boolean
  
  updateJar(jar: JarInfo): void
  
  getTransactions(limit = 100): Transaction[]
}
```

Дедуплікація по `transaction.id` — якщо вебхук і polling доставили одну транзакцію, до WebSocket broadcast вона потрапить лише один раз.

### poller.ts — фоновий процес

```typescript
// Запускається при старті сервера, працює незалежно від вебхуку
// Алгоритм:
// 1. Кожні POLL_INTERVAL_MS: GET /personal/statement/{JAR_ID}/{from}/{to}
//    де from = час останньої відомої транзакції (або now-3600 при першому запуску)
// 2. Для кожної нової транзакції:
//    - cache.addTransaction(tx) → якщо повернув true (нова)
//    - broadcast через ws
// 3. GET /personal/client-info для оновлення balance/goal в JarInfo
// 4. Обробка 429: пропустити поточний тік, retry через 60 сек
// 5. Обробка інших помилок: логувати, не крашити процес
```

### webhook.ts

```typescript
// POST /webhook
// 1. Перевірити що data.account === JAR_ID
// 2. cache.addTransaction(statementItem) → якщо true (нова)
//    - broadcast через ws
//    - оновити jarInfo.balance в кеші
// 3. Відповісти 200 OK протягом 5 сек (вимога Mono)
```

Вебхук і poller пишуть через той самий `cache.addTransaction()` — дедуп гарантований.

### ws.ts — WebSocket broadcaster

```typescript
// При connect:
//   → надіслати { type: 'init', jar: JarInfo, transactions: Transaction[] }
// При новій транзакції (з будь-якого джерела):
//   → broadcast { type: 'transaction', data: Transaction, jar: { balance, goal? } }
// Ping кожні 30 сек → очікувати pong → якщо немає 2 тіки поспіль — закрити з'єднання
```

### WebSocket протокол

**Сервер → клієнт:**
```typescript
{ type: 'init', jar: JarInfo, transactions: Transaction[] }
{ type: 'transaction', data: Transaction, jar: { balance: number, goal?: number } }
{ type: 'ping' }
```

**Клієнт → сервер:**
```typescript
{ type: 'pong' }
```

### Frontend (public/index.html)

Референс дизайну — прикріплений `mono-jar-dashboard.html` (dark theme, Unbounded font). Прибрати форму вводу токену/jar.

**WebSocket логіка:**
```javascript
// connect до ws://same-host/ws
// 'init'        → відрендерити jar info + транзакції
// 'transaction' → prepend в feed з анімацією + toast
// 'ping'        → відповісти { type: 'pong' }
// disconnect    → показати "з'єднання втрачено", reconnect через 3s
//                 після reconnect — запросити /api/transactions
//                 щоб не пропустити поки були офлайн
```

**UI стан з'єднання:**
- 🟢 live — WebSocket підключений
- 🟡 reconnecting... — спроба перепідключення
- 🔴 offline — немає з'єднання >10 сек

### Налаштування вебхуку на Mono (один раз після деплою)

```bash
curl -X POST https://api.monobank.ua/personal/webhook \
  -H "X-Token: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"webHookUrl": "https://your-domain.synology.me/webhook"}'
```

Synology має бути доступний ззовні через DDNS або статичний IP + port forwarding → reverse proxy.

### Docker

**Dockerfile** (multi-stage build):
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
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY public ./public
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

**docker-compose.yml:**
```yaml
version: '3.8'
services:
  mono-jar:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file: .env
    volumes:
      - ./logs:/app/logs
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

### package.json scripts
```json
{
  "scripts": {
    "build": "tsc",
    "dev": "ts-node-dev --respawn src/server.ts",
    "start": "node dist/server.js"
  }
}
```

### Що НЕ потрібно
- БД — все в пам'яті, при рестарті poller підтягне останню годину
- Авторизація на фронті — дашборд публічний
- HTTPS — Synology reverse proxy покриє

### Референс файли
Прикріпити до промпту: `mono-jar-dashboard.html`