#!/usr/bin/env tsx
/**
 * Datasheet Lookup Dataset Upload Script
 *
 * Reads CSV files from datasets/datasheet_lookup/, converts them, and uploads
 * to Langfuse. The dataset name is DatasheetLookup-{filename without .csv}.
 *
 * Usage:
 *   npx tsx scripts/upload-datasheet-lookup.ts --file example.csv
 *   npx tsx scripts/upload-datasheet-lookup.ts --all
 *   npx tsx scripts/upload-datasheet-lookup.ts --changed
 *   npx tsx scripts/upload-datasheet-lookup.ts --all --dry-run
 */

import fs from 'fs'
import path from 'path'
import { convertDatasheetLookup } from '../src/converters/datasheetLookupConverters.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATASETS_DIR = path.resolve(import.meta.dirname || __dirname, '..', 'datasets', 'datasheet_lookup')

function getLangfuseConfig() {
  const baseUrl = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com'
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY || ''
  const secretKey = process.env.LANGFUSE_SECRET_KEY || ''
  return { baseUrl, publicKey, secretKey }
}

// ---------------------------------------------------------------------------
// Langfuse API helpers
// ---------------------------------------------------------------------------

async function langfuseRequest(
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    throw new Error(`Network error calling ${method} ${url}: ${err instanceof Error ? err.message : err}`)
  }

  let data: unknown = null
  try { data = await res.json() } catch { /* no body */ }
  return { ok: res.ok, status: res.status, data }
}

async function createDataset(name: string): Promise<void> {
  const res = await langfuseRequest('POST', '/api/public/v2/datasets', { name })
  if (!res.ok && res.status !== 409) {
    throw new Error(`Failed to create dataset "${name}": ${res.status} ${JSON.stringify(res.data)}`)
  }
}

async function uploadDatasetItem(
  datasetName: string,
  input: Record<string, unknown>,
  expectedOutput: unknown,
): Promise<void> {
  const res = await langfuseRequest('POST', '/api/public/dataset-items', {
    datasetName,
    input,
    expectedOutput,
  })
  if (!res.ok) {
    throw new Error(`Failed to upload item to "${datasetName}": ${res.status} ${JSON.stringify(res.data)}`)
  }
}

async function listDatasetItemIds(datasetName: string): Promise<string[]> {
  const ids: string[] = []
  let page = 1
  while (true) {
    const res = await langfuseRequest(
      'GET',
      `/api/public/dataset-items?datasetName=${encodeURIComponent(datasetName)}&page=${page}&limit=50`,
    )
    if (!res.ok) {
      if (res.status === 404) return ids
      throw new Error(`Failed to list items for "${datasetName}": HTTP ${res.status}`)
    }
    const body = res.data as { data: { id: string }[]; meta: { page: number; totalPages: number } }
    for (const item of body.data) ids.push(item.id)
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

async function clearDatasetItems(datasetName: string): Promise<number> {
  const itemIds = await listDatasetItemIds(datasetName)
  for (const id of itemIds) await deleteDatasetItem(id)
  return itemIds.length
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function listCsvFiles(): string[] {
  if (!fs.existsSync(DATASETS_DIR)) return []
  return fs.readdirSync(DATASETS_DIR).filter(name => name.endsWith('.csv'))
}

async function processFile(csvFilename: string, dryRun: boolean): Promise<void> {
  const prefix = csvFilename.replace(/\.csv$/, '')
  const datasetName = `DatasheetLookup-${prefix}`
  const csvPath = path.join(DATASETS_DIR, csvFilename)
  const csvText = fs.readFileSync(csvPath, 'utf-8')

  console.log(`\n--- ${csvFilename} -> "${datasetName}" ---`)

  const output = convertDatasheetLookup(csvText, datasetName)
  console.log(`  ${output.rows.length} items`)

  if (!dryRun) {
    await createDataset(datasetName)

    const deletedCount = await clearDatasetItems(datasetName)
    if (deletedCount > 0) {
      console.log(`  -> cleared ${deletedCount} existing items`)
    }

    for (const row of output.rows) {
      await uploadDatasetItem(datasetName, row.input, row.expectedOutput)
    }
    console.log(`  -> uploaded ${output.rows.length} items`)
  } else {
    console.log(`  -> (dry run, skipped upload)`)
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const all = args.includes('--all')
  const changed = args.includes('--changed')
  const fileIdx = args.indexOf('--file')
  const fileArg = fileIdx !== -1 ? args[fileIdx + 1] : null

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
  if (!dryRun && (!config.publicKey || !config.secretKey)) {
    console.error('Error: Langfuse credentials not found. Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY.')
    process.exit(1)
  }

  if (dryRun) {
    console.log('[DRY RUN] No uploads will be performed.\n')
  }

  let csvFiles: string[]

  if (fileArg) {
    if (!fs.existsSync(path.join(DATASETS_DIR, fileArg))) {
      console.error(`Error: File not found: datasets/datasheet_lookup/${fileArg}`)
      process.exit(1)
    }
    csvFiles = [fileArg]
  } else if (changed) {
    const { execSync } = await import('child_process')
    try {
      const diffOutput = execSync('git diff --name-only HEAD~1 HEAD -- datasets/datasheet_lookup/', { encoding: 'utf-8' })
      const changedFiles = new Set<string>()
      for (const file of diffOutput.trim().split('\n')) {
        if (!file) continue
        const basename = path.basename(file)
        if (basename.endsWith('.csv') && fs.existsSync(path.join(DATASETS_DIR, basename))) {
          changedFiles.add(basename)
        }
      }
      csvFiles = [...changedFiles]
      if (csvFiles.length === 0) {
        console.log('No changed CSV files detected.')
        return
      }
      console.log(`Detected ${csvFiles.length} changed file(s): ${csvFiles.join(', ')}`)
    } catch {
      console.error('Warning: Could not detect changed files from git. Processing all.')
      csvFiles = listCsvFiles()
    }
  } else if (all) {
    csvFiles = listCsvFiles()
    if (csvFiles.length === 0) {
      console.log('No CSV files found in datasets/datasheet_lookup/')
      return
    }
    console.log(`Processing ${csvFiles.length} file(s): ${csvFiles.join(', ')}`)
  } else {
    console.log(`Usage:
  npx tsx scripts/upload-datasheet-lookup.ts --file example.csv
  npx tsx scripts/upload-datasheet-lookup.ts --all
  npx tsx scripts/upload-datasheet-lookup.ts --changed

Options:
  --dry-run   Preview conversion without uploading`)
    process.exit(0)
  }

  let hasErrors = false
  for (const file of csvFiles) {
    try {
      await processFile(file, dryRun)
    } catch (err) {
      hasErrors = true
      console.error(`\nERROR processing ${file}:`, err instanceof Error ? err.message : err)
    }
  }

  if (hasErrors) {
    console.error('\nSome files failed. Check output above.')
    process.exit(1)
  }

  console.log('\nDone.')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
