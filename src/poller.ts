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
        from = lastTime !== null ? lastTime - 10 : now - Math.ceil(interval / 1000) - 10
      }

      console.log(`[poller] tick from=${new Date(from * 1000).toISOString()}`)
      const txs = await fetchTransactions(token, jarId, from, now)
      const incoming = txs.filter(t => t.amount > 0)
      console.log(`[poller] fetched ${txs.length} txs, ${incoming.length} incoming`)
      incoming.sort((a, b) => a.time - b.time)

      for (const tx of incoming) {
        if (cache.addTransaction(tx)) {
          const jar = cache.getJar()
          if (jar) {
            const updatedJar = { ...jar, balance: tx.balance }
            cache.updateJar(updatedJar)
            console.log(`[poller] new tx id=${tx.id} amount=+${(tx.amount / 100).toFixed(2)}₴ desc="${tx.description}" balance=${(tx.balance / 100).toFixed(2)}₴`)
            broadcast(tx, updatedJar)
          }
        }
      }

      try {
        const jar = await fetchJarInfo(token, jarId)
        cache.updateJar(jar)
        console.log(`[poller] jar balance=${(jar.balance / 100).toFixed(2)}₴${jar.goal ? ` goal=${(jar.goal / 100).toFixed(2)}₴` : ''}`)
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
