jest.mock('../src/mono')

import * as mono from '../src/mono'
import { Cache } from '../src/cache'
import { startPoller } from '../src/poller'
import { JarInfo, Transaction } from '../src/mono'

const mockFetchTransactions = mono.fetchTransactions as jest.MockedFunction<typeof mono.fetchTransactions>
const mockFetchJarInfo = mono.fetchJarInfo as jest.MockedFunction<typeof mono.fetchJarInfo>

const flushPromises = () => new Promise<void>(resolve => setImmediate(resolve))

const jar: JarInfo = { id: 'jar1', sendId: 's1', title: 'Test', balance: 5000, currencyCode: 980 }
const tx: Transaction = { id: 'tx1', time: 1000, amount: 100, description: 'test', balance: 5100 }

describe('startPoller', () => {
  let cache: Cache
  let broadcast: jest.Mock

  beforeEach(() => {
    cache = new Cache()
    cache.updateJar(jar)
    broadcast = jest.fn()
    mockFetchTransactions.mockResolvedValue([tx])
    mockFetchJarInfo.mockResolvedValue(jar)
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  it('calls fetchTransactions on first tick', async () => {
    startPoller(cache, broadcast)
    await flushPromises()
    expect(mockFetchTransactions).toHaveBeenCalledTimes(1)
    const [, , from] = mockFetchTransactions.mock.calls[0]
    const now = Math.floor(Date.now() / 1000)
    expect(from).toBeGreaterThanOrEqual(now - 10810)
    expect(from).toBeLessThanOrEqual(now - 10790)
  })

  it('broadcasts incoming transactions on first tick', async () => {
    startPoller(cache, broadcast)
    await flushPromises()
    expect(broadcast).toHaveBeenCalledWith(tx, expect.objectContaining({ id: 'jar1' }))
  })

  it('does not broadcast duplicate transactions', async () => {
    cache.addTransaction(tx)
    startPoller(cache, broadcast)
    await flushPromises()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('skips negative amount transactions', async () => {
    mockFetchTransactions.mockResolvedValue([{ ...tx, amount: -100 }])
    startPoller(cache, broadcast)
    await flushPromises()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('handles RATE_LIMIT without crashing', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation()
    mockFetchTransactions.mockRejectedValue(new Error('RATE_LIMIT'))
    startPoller(cache, broadcast)
    await flushPromises()
    expect(logSpy).toHaveBeenCalledWith('[poller] rate limited, skipping tick')
    expect(broadcast).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('logs and continues on unknown error', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation()
    mockFetchTransactions.mockRejectedValue(new Error('Network failure'))
    startPoller(cache, broadcast)
    await flushPromises()
    expect(errorSpy).toHaveBeenCalledWith('[poller] error:', 'Network failure')
    errorSpy.mockRestore()
  })

  it('uses lastTransactionTime on subsequent ticks', async () => {
    cache.addTransaction({ ...tx, time: 9000 })
    startPoller(cache, broadcast)
    await flushPromises()
    jest.advanceTimersByTime(60000)
    await flushPromises()
    const secondCallFrom = mockFetchTransactions.mock.calls[1][2]
    expect(secondCallFrom).toBe(9000 - 10)
  })

  it('falls back to now-70 on subsequent tick when cache still empty', async () => {
    mockFetchTransactions.mockResolvedValue([])
    mockFetchJarInfo.mockResolvedValue(jar)
    startPoller(cache, broadcast)
    await flushPromises()
    jest.advanceTimersByTime(60000)
    await flushPromises()
    const secondCallFrom = mockFetchTransactions.mock.calls[1][2]
    const now = Math.floor(Date.now() / 1000)
    expect(secondCallFrom).toBeGreaterThanOrEqual(now - 80)
    expect(secondCallFrom).toBeLessThanOrEqual(now - 60)
  })
})
