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
