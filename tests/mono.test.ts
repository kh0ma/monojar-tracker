import { fetchJarInfo, fetchTransactions } from '../src/mono'

function mockFetch(status: number, body: unknown): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  }) as unknown as typeof fetch
}

afterEach(() => jest.restoreAllMocks())

describe('fetchJarInfo', () => {
  const jar = { id: 'jar1', sendId: 's1', title: 'Test', balance: 5000, currencyCode: 980 }

  it('returns jar matching by id', async () => {
    mockFetch(200, { jars: [jar] })
    expect(await fetchJarInfo('token', 'jar1')).toEqual(jar)
  })

  it('returns jar matching by sendId', async () => {
    mockFetch(200, { jars: [jar] })
    expect(await fetchJarInfo('token', 's1')).toEqual(jar)
  })

  it('throws RATE_LIMIT on 429', async () => {
    mockFetch(429, {})
    await expect(fetchJarInfo('token', 'jar1')).rejects.toThrow('RATE_LIMIT')
  })

  it('throws HTTP error on non-200', async () => {
    mockFetch(401, {})
    await expect(fetchJarInfo('token', 'jar1')).rejects.toThrow('HTTP 401')
  })

  it('throws JAR_NOT_FOUND when jar absent', async () => {
    mockFetch(200, { jars: [] })
    await expect(fetchJarInfo('token', 'jar1')).rejects.toThrow('JAR_NOT_FOUND')
  })
})

describe('fetchTransactions', () => {
  const tx = { id: 'tx1', time: 1000, amount: 100, description: 'test', balance: 1000 }

  it('returns array of transactions', async () => {
    mockFetch(200, [tx])
    expect(await fetchTransactions('token', 'jar1', 0, 1000)).toEqual([tx])
  })

  it('returns empty array for non-array response', async () => {
    mockFetch(200, null)
    expect(await fetchTransactions('token', 'jar1', 0, 1000)).toEqual([])
  })

  it('throws RATE_LIMIT on 429', async () => {
    mockFetch(429, {})
    await expect(fetchTransactions('token', 'jar1', 0, 1000)).rejects.toThrow('RATE_LIMIT')
  })
})
