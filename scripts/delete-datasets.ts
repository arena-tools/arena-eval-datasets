#!/usr/bin/env tsx
/**
 * Delete Langfuse datasets by name.
 *
 * Langfuse has no DELETE endpoint for datasets themselves, so this script
 * lists all items in each dataset and deletes them one by one. The empty
 * dataset shell remains in Langfuse but has zero items.
 *
 * Usage:
 *   npx tsx scripts/delete-datasets.ts --names "ds-rule-abc1234,ds-fanout-abc1234,..."
 */

import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getLangfuseConfig() {
  const baseUrl = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com'
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY || ''
  const secretKey = process.env.LANGFUSE_SECRET_KEY || ''
  return { baseUrl, publicKey, secretKey }
}

// ---------------------------------------------------------------------------
// Langfuse API
// ---------------------------------------------------------------------------

interface DatasetItem {
  id: string
}

interface ListItemsResponse {
  data: DatasetItem[]
  meta: { page: number; limit: number; totalItems: number; totalPages: number }
}

async function langfuseRequest(
  method: string,
  endpoint: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const config = getLangfuseConfig()
  const authHeader = 'Basic ' + Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')
  const url = `${config.baseUrl}${endpoint}`

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
  })

  let data: unknown = null
  try { data = await res.json() } catch { /* no body */ }
  return { ok: res.ok, status: res.status, data }
}

async function listDatasetItems(datasetName: string): Promise<string[]> {
  const ids: string[] = []
  let page = 1
  while (true) {
    const res = await langfuseRequest(
      'GET',
      `/api/public/dataset-items?datasetName=${encodeURIComponent(datasetName)}&page=${page}&limit=50`,
    )
    if (!res.ok) {
      if (res.status === 404) return ids // dataset doesn't exist
      throw new Error(`Failed to list items for "${datasetName}": HTTP ${res.status}`)
    }
    const body = res.data as ListItemsResponse
    for (const item of body.data) {
      ids.push(item.id)
    }
    if (page >= body.meta.totalPages) break
    page++
  }
  return ids
}

async function deleteDatasetItem(itemId: string): Promise<void> {
  const res = await langfuseRequest('DELETE', `/api/public/dataset-items/${itemId}`)
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete item ${itemId}: HTTP ${res.status}`)
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const namesIdx = args.indexOf('--names')
  const namesArg = namesIdx !== -1 ? args[namesIdx + 1] : null

  if (!namesArg) {
    console.error('Usage: npx tsx scripts/delete-datasets.ts --names "name1,name2,..."')
    process.exit(1)
  }

  // Load .env if present
  const envPath = path.resolve(import.meta.dirname || __dirname, '..', '.env')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let value = trimmed.slice(eqIdx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  }

  const config = getLangfuseConfig()
  if (!config.publicKey || !config.secretKey) {
    console.error('Error: Langfuse credentials not found. Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY.')
    process.exit(1)
  }

  const names = namesArg.split(',').map(n => n.trim()).filter(Boolean)
  console.log(`Deleting items from ${names.length} dataset(s)...\n`)

  let hasErrors = false
  for (const name of names) {
    try {
      console.log(`  ${name}:`)
      const itemIds = await listDatasetItems(name)
      if (itemIds.length === 0) {
        console.log(`    No items found (empty or missing), skipping.`)
        continue
      }
      console.log(`    Found ${itemIds.length} items, deleting...`)
      for (const id of itemIds) {
        await deleteDatasetItem(id)
      }
      console.log(`    Deleted ${itemIds.length} items.`)
    } catch (err) {
      console.error(`    FAILED: ${err instanceof Error ? err.message : err}`)
      hasErrors = true
    }
  }

  if (hasErrors) {
    console.error('\nSome deletions failed.')
    process.exit(1)
  }

  console.log('\nDone.')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
