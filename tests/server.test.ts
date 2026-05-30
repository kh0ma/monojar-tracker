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
