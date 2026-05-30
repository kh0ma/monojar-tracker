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
