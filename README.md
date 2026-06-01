# mono-jar

Real-time Monobank jar (donation jar) dashboard. Shows incoming transactions as they arrive — via webhook push with 60-second polling as a fallback.

## How it works

```
Monobank API ←── polling 60s ──┐
                                ├── in-memory cache ──→ WebSocket ──→ browser
Monobank ──→ POST /webhook ────┘
```

- Webhook delivers transactions instantly
- Polling ensures nothing is missed if the webhook is temporarily unavailable
- All browser clients share one backend cache — Monobank's 1-request/minute rate limit is respected regardless of how many tabs are open
- Data is held in memory; on restart the last 3 hours are re-fetched from Monobank

## Quick start

**1. Create `.env`**

```env
MONO_TOKEN=your_token_here
JAR_ID=your_jar_id_here
PORT=3000
POLL_INTERVAL_MS=60000
```

**2. Create `docker-compose.yml`**

```yaml
services:
  mono-jar:
    image: kh0ma/mono-jar:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file: .env
```

**3. Run**

```bash
docker compose up -d
```

Open `http://localhost:3000`.

---

## Monobank setup

### 1. Get API token

Go to [api.monobank.ua](https://api.monobank.ua), sign in via the Monobank app, and copy your token.

### 2. Find your Jar ID

Call the client-info endpoint and look for your jar in the `jars` array:

```bash
curl --location 'https://api.monobank.ua/personal/client-info' \
--header 'X-Token: TOKEN'
```

Response contains a `jars` array. Each jar has an `id` field — use that as `JAR_ID`.

### 3. Register webhook

Once your service is publicly accessible, register the webhook URL with Monobank:

```bash
curl --location 'https://api.monobank.ua/personal/webhook' \
--header 'X-Token: TOKEN' \
--header 'Content-Type: application/json' \
--data '{"webHookUrl": "https://your-public-deployment.dns.com/webhook"}'
```

This is a one-time step. Monobank will push new transactions to `/webhook` immediately as they occur.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MONO_TOKEN` | — | Monobank personal API token |
| `JAR_ID` | — | Jar ID from `/personal/client-info` |
| `PORT` | `3000` | HTTP port |
| `POLL_INTERVAL_MS` | `60000` | Polling interval in milliseconds |
