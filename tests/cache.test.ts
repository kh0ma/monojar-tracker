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
      expect(cache.addTransaction(makeTx('tx0', 0))).toBe(true)
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
