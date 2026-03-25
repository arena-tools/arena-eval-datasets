#!/usr/bin/env tsx
/**
 * Delete Langfuse datasets by name.
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

async function deleteDataset(name: string): Promise<{ ok: boolean; status: number }> {
  const config = getLangfuseConfig()
  const authHeader = 'Basic ' + Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')
  const url = `${config.baseUrl}/api/public/v2/datasets/${encodeURIComponent(name)}`

  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
  })

  return { ok: res.ok, status: res.status }
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
  console.log(`Deleting ${names.length} dataset(s)...`)

  let hasErrors = false
  for (const name of names) {
    try {
      const res = await deleteDataset(name)
      if (res.ok || res.status === 404) {
        console.log(`  Deleted: ${name}${res.status === 404 ? ' (not found, skipped)' : ''}`)
      } else {
        console.error(`  FAILED: ${name} (HTTP ${res.status})`)
        hasErrors = true
      }
    } catch (err) {
      console.error(`  FAILED: ${name} (${err instanceof Error ? err.message : err})`)
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
