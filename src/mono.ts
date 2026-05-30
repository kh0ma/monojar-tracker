const BASE = 'https://api.monobank.ua'

export interface JarInfo {
  id: string
  sendId: string
  title: string
  balance: number
  goal?: number
  currencyCode: number
}

export interface Transaction {
  id: string
  time: number
  amount: number
  description: string
  balance: number
}

export interface WebhookPayload {
  type: 'StatementItem'
  data: {
    account: string
    statementItem: Transaction
  }
}

export async function fetchJarInfo(token: string, jarId: string): Promise<JarInfo> {
  const res = await fetch(`${BASE}/personal/client-info`, {
    headers: { 'X-Token': token },
  })
  if (res.status === 429) throw new Error('RATE_LIMIT')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json() as { jars?: JarInfo[] }
  const jar = (data.jars ?? []).find(j => j.id === jarId || j.sendId === jarId)
  if (!jar) throw new Error('JAR_NOT_FOUND')
  return jar
}

export async function fetchTransactions(
  token: string,
  jarId: string,
  fromTs: number,
  toTs: number,
): Promise<Transaction[]> {
  const res = await fetch(`${BASE}/personal/statement/${jarId}/${fromTs}/${toTs}`, {
    headers: { 'X-Token': token },
  })
  if (res.status === 429) throw new Error('RATE_LIMIT')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? data as Transaction[] : []
}
