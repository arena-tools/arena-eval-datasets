/**
 * Shared Langfuse API helpers used by all upload scripts.
 */

export function getLangfuseConfig() {
  const baseUrl = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com'
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY || ''
  const secretKey = process.env.LANGFUSE_SECRET_KEY || ''
  return { baseUrl, publicKey, secretKey }
}

export async function langfuseRequest(
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const config = getLangfuseConfig()
  const authHeader = 'Basic ' + Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')
  const url = `${config.baseUrl}${endpoint}`

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    throw new Error(`Network error calling ${method} ${url}: ${err instanceof Error ? err.message : err}`)
  }

  let data: unknown = null
  try { data = await res.json() } catch { /* no body */ }
  return { ok: res.ok, status: res.status, data }
}

export async function createDataset(name: string): Promise<void> {
  const res = await langfuseRequest('POST', '/api/public/v2/datasets', { name })
  if (!res.ok && res.status !== 409) {
    throw new Error(`Failed to create dataset "${name}": ${res.status} ${JSON.stringify(res.data)}`)
  }
}

export async function uploadDatasetItem(
  datasetName: string,
  input: Record<string, unknown>,
  expectedOutput: unknown,
): Promise<void> {
  const res = await langfuseRequest('POST', '/api/public/dataset-items', { datasetName, input, expectedOutput })
  if (!res.ok) {
    throw new Error(`Failed to upload item to "${datasetName}": ${res.status} ${JSON.stringify(res.data)}`)
  }
}

export async function clearDatasetItems(datasetName: string): Promise<number> {
  const ids: string[] = []
  let page = 1
  while (true) {
    const res = await langfuseRequest(
      'GET',
      `/api/public/dataset-items?datasetName=${encodeURIComponent(datasetName)}&page=${page}&limit=50`,
    )
    if (!res.ok) {
      if (res.status === 404) break
      throw new Error(`Failed to list items for "${datasetName}": HTTP ${res.status}`)
    }
    const body = res.data as { data: { id: string }[]; meta: { page: number; totalPages: number } }
    for (const item of body.data) ids.push(item.id)
    if (page >= body.meta.totalPages) break
    page++
  }
  for (const id of ids) {
    const res = await langfuseRequest('DELETE', `/api/public/dataset-items/${id}`)
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete item ${id}: HTTP ${res.status}`)
    }
  }
  return ids.length
}
