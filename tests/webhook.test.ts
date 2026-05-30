import express from 'express'
import request from 'supertest'
import { createWebhookHandler } from '../src/webhook'
import { Cache } from '../src/cache'
import { JarInfo, Transaction } from '../src/mono'

const jar: JarInfo = { id: 'jar1', sendId: 's1', title: 'Test', balance: 5000, currencyCode: 980 }

const validPayload = {
  type: 'StatementItem',
  data: {
    account: 'jar1',
    statementItem: { id: 'tx1', time: 1000, amount: 100, description: 'Donation', balance: 5100 },
  },
}

function makeApp(cache: Cache, broadcast: jest.Mock) {
  const app = express()
  app.use(express.json())
  app.post('/webhook', createWebhookHandler(cache, broadcast))
  return app
}

describe('createWebhookHandler', () => {
  let cache: Cache
  let broadcast: jest.Mock

  beforeEach(() => {
    cache = new Cache()
    cache.updateJar(jar)
    broadcast = jest.fn()
  })

  it('responds 200 for valid payload', async () => {
    await request(makeApp(cache, broadcast)).post('/webhook').send(validPayload).expect(200)
  })

  it('calls broadcast with new transaction and updated jar', async () => {
    await request(makeApp(cache, broadcast)).post('/webhook').send(validPayload)
    expect(broadcast).toHaveBeenCalledTimes(1)
    const [broadcastTx, broadcastJar] = broadcast.mock.calls[0]
    expect(broadcastTx.id).toBe('tx1')
    expect(broadcastJar.balance).toBe(5100)
  })

  it('does not broadcast duplicate transaction', async () => {
    cache.addTransaction(validPayload.data.statementItem as Transaction)
    await request(makeApp(cache, broadcast)).post('/webhook').send(validPayload)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('ignores non-StatementItem type', async () => {
    await request(makeApp(cache, broadcast)).post('/webhook')
      .send({ type: 'Other', data: {} }).expect(200)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('ignores wrong account', async () => {
    const payload = { ...validPayload, data: { ...validPayload.data, account: 'other' } }
    await request(makeApp(cache, broadcast)).post('/webhook').send(payload).expect(200)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('ignores negative amounts', async () => {
    const payload = {
      ...validPayload,
      data: { ...validPayload.data, statementItem: { ...validPayload.data.statementItem, amount: -100 } },
    }
    await request(makeApp(cache, broadcast)).post('/webhook').send(payload).expect(200)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('ignores zero amounts', async () => {
    const payload = {
      ...validPayload,
      data: { ...validPayload.data, statementItem: { ...validPayload.data.statementItem, amount: 0 } },
    }
    await request(makeApp(cache, broadcast)).post('/webhook').send(payload).expect(200)
    expect(broadcast).not.toHaveBeenCalled()
  })
})
