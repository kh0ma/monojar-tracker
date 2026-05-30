import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { Cache } from './cache'
import { JarInfo, Transaction } from './mono'

export const PING_INTERVAL_MS = 30_000

export function createWsServer(
  server: http.Server,
  cache: Cache,
  pingIntervalMs: number = PING_INTERVAL_MS,
): { broadcast: (tx: Transaction, jar: JarInfo) => void } {
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws, req) => {
    const ip = req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?'
    console.log(`[ws] client connected ip=${ip} (active: ${wss.clients.size})`)
    let missedPongs = 0

    const pingTimer = setInterval(() => {
      if (missedPongs >= 2) {
        ws.terminate()
        return
      }
      missedPongs++
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }), () => {})
      }
    }, pingIntervalMs)

    ws.on('message', data => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string }
        if (msg.type === 'pong') missedPongs = 0
      } catch {
        // ignore malformed messages
      }
    })

    ws.on('close', () => {
      clearInterval(pingTimer)
      console.log(`[ws] client disconnected ip=${ip} (active: ${wss.clients.size})`)
    })
    ws.on('error', () => clearInterval(pingTimer))

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'init',
        jar: cache.getJar(),
        transactions: cache.getTransactions(),
      }))
    }
  })

  return {
    broadcast(tx: Transaction, jar: JarInfo): void {
      const open = [...wss.clients].filter(c => c.readyState === WebSocket.OPEN)
      console.log(`[ws] broadcast tx id=${tx.id} amount=+${(tx.amount / 100).toFixed(2)}₴ to ${open.length} client(s)`)
      const msg = JSON.stringify({
        type: 'transaction',
        data: tx,
        jar: { balance: jar.balance, goal: jar.goal },
      })
      for (const client of open) {
        client.send(msg)
      }
    },
  }
}
