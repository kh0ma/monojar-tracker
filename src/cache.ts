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
