import 'dotenv/config'
import http from 'http'
import path from 'path'
import express from 'express'
import { Cache } from './cache'
import { createWebhookHandler } from './webhook'
import { createWsServer } from './ws'
import { startPoller } from './poller'

export const cache = new Cache()

const _app = express()
_app.set('trust proxy', 1)
_app.use(express.json())
_app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/webhook') {
    const start = Date.now()
    res.on('finish', () => {
      const ip = req.headers['x-forwarded-for'] ?? req.ip ?? '?'
      console.log(`[http] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms ip=${ip}`)
    })
  }
  next()
})

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
