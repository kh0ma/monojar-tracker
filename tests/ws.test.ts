import http from 'http'
import WebSocket from 'ws'
import { AddressInfo } from 'net'
import { Cache } from '../src/cache'
import { createWsServer } from '../src/ws'
import { JarInfo, Transaction } from '../src/mono'

const jar: JarInfo = { id: 'jar1', sendId: 's1', title: 'Test', balance: 5000, currencyCode: 980 }
const tx: Transaction = { id: 'tx1', time: 1000, amount: 100, description: 'test', balance: 5100 }

function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise(resolve => ws.once('message', data => resolve(JSON.parse(data.toString()))))
}

describe('createWsServer', () => {
  let server: http.Server
  let cache: Cache
  let wsServer: ReturnType<typeof createWsServer>
  let port: number

  beforeEach(() => new Promise<void>(resolve => {
    cache = new Cache()
    cache.updateJar(jar)
    server = http.createServer()
    wsServer = createWsServer(server, cache, 100)
    server.listen(0, () => {
      port = (server.address() as AddressInfo).port
      resolve()
    })
  }))

  afterEach(() => new Promise<void>(resolve => server.close(() => resolve())))

  it('sends init message on connect', async () => {
    const client = new WebSocket(`ws://localhost:${port}/ws`)
    const msg = await waitForMessage(client) as { type: string; jar: JarInfo; transactions: Transaction[] }
    expect(msg.type).toBe('init')
    expect(msg.jar).toEqual(jar)
    expect(msg.transactions).toEqual([])
    client.terminate()
  })

  it('includes cached transactions in init', async () => {
    cache.addTransaction(tx)
    const client = new WebSocket(`ws://localhost:${port}/ws`)
    const msg = await waitForMessage(client) as { transactions: Transaction[] }
    expect(msg.transactions).toHaveLength(1)
    expect(msg.transactions[0].id).toBe('tx1')
    client.terminate()
  })

  it('broadcasts transaction to all connected clients', done => {
    const client = new WebSocket(`ws://localhost:${port}/ws`)
    client.once('open', () => {
      // consume init message
      client.once('message', () => {
        client.once('message', data => {
          const msg = JSON.parse(data.toString())
          expect(msg.type).toBe('transaction')
          expect(msg.data.id).toBe('tx1')
          expect(msg.jar.balance).toBe(5100)
          client.terminate()
          done()
        })
        wsServer.broadcast(tx, { ...jar, balance: 5100 })
      })
    })
  })

  it('replies to ping with pong from client', done => {
    const client = new WebSocket(`ws://localhost:${port}/ws`)
    client.on('message', data => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'ping') {
        client.send(JSON.stringify({ type: 'pong' }))
        client.terminate()
        done()
      }
    })
  })
})
