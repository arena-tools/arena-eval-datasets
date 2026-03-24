#!/usr/bin/env tsx
/**
 * SRC Eval Dataset Upload Script
 *
 * Reads SRC eval dataset CSVs from datasets/src/{boardId}/, converts them using
 * the shared srcDatasetConverters, and uploads to Langfuse via API.
 *
 * Usage:
 *   npx tsx scripts/upload-datasets.ts --board 139-4947
 *   npx tsx scripts/upload-datasets.ts --all
 *   npx tsx scripts/upload-datasets.ts --board 139-4947 --dry-run
 *   npx tsx scripts/upload-datasets.ts --changed   # only boards changed in last commit
 */

import fs from 'fs'
import path from 'path'
import { convertAll, DatasetOutput } from '../src/converters/srcDatasetConverters.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Metadata {
  boardId: string
  datasetNamePrefix: string
  description?: string
  author?: string
  createdAt?: string
  langfuseProject?: string
  mode?: 'create_new' | 'add_to_existing'
  existingDatasetNames?: Record<string, string>
}

interface UploadReceipt {
  uploadedAt: string
  boardId: string
  mode: string
  datasets: {
    name: string
    datasetName: string
    itemCount: number
  }[]
  success: boolean
  error?: string
}

interface ManifestEntry {
  boardId: string
  directory: string
  datasetNamePrefix: string
  description?: string
  author?: string
  lastUpload?: {
    uploadedAt: string
    datasets: { name: string; datasetName: string; itemCount: number }[]
  }
}

interface Manifest {
  datasets: ManifestEntry[]
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATASETS_DIR = path.resolve(import.meta.dirname || __dirname, '..', 'datasets', 'src')

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
  try {
    data = await res.json()
  } catch {
    // response may not be JSON
  }

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
  expectedOutput: Record<string, unknown>,
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

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function listBoardDirs(): string[] {
  if (!fs.existsSync(DATASETS_DIR)) return []
  return fs.readdirSync(DATASETS_DIR).filter(name => {
    const dir = path.join(DATASETS_DIR, name)
    return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'metadata.json'))
  })
}

function readMetadata(boardDir: string): Metadata {
  const metaPath = path.join(DATASETS_DIR, boardDir, 'metadata.json')
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
}

function readCsv(boardDir: string): string {
  const csvPath = path.join(DATASETS_DIR, boardDir, 'src-eval.csv')
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`)
  }
  return fs.readFileSync(csvPath, 'utf-8')
}

function getDatasetName(metadata: Metadata, output: DatasetOutput): string {
  if (metadata.mode === 'add_to_existing' && metadata.existingDatasetNames?.[output.name]) {
    return metadata.existingDatasetNames[output.name]
  }
  return `${metadata.datasetNamePrefix}-${output.name}`
}

async function processBoard(boardDir: string, dryRun: boolean): Promise<UploadReceipt> {
  const metadata = readMetadata(boardDir)
  const csvText = readCsv(boardDir)

  console.log(`\n--- Board: ${metadata.boardId} (${boardDir}) ---`)
  console.log(`  Prefix: ${metadata.datasetNamePrefix}`)
  console.log(`  Mode:   ${metadata.mode || 'create_new'}`)

  const outputs = convertAll(csvText, metadata.boardId)
  const receiptDatasets: UploadReceipt['datasets'] = []

  for (const output of outputs) {
    const datasetName = getDatasetName(metadata, output)
    console.log(`  [${output.name}] ${output.rows.length} items -> "${datasetName}"`)

    if (!dryRun) {
      if (metadata.mode !== 'add_to_existing') {
        await createDataset(datasetName)
      }

      for (const row of output.rows) {
        const input: Record<string, unknown> = {}
        const expectedOutput = row.expected_output ? JSON.parse(row.expected_output) : {}

        for (const [key, value] of Object.entries(row)) {
          if (key === 'expected_output') continue
          if (value.startsWith('[')) {
            try { input[key] = JSON.parse(value) } catch { input[key] = value }
          } else {
            input[key] = value
          }
        }

        await uploadDatasetItem(datasetName, input, expectedOutput)
      }
      console.log(`    -> uploaded ${output.rows.length} items`)
    } else {
      console.log(`    -> (dry run, skipped upload)`)
    }

    receiptDatasets.push({ name: output.name, datasetName, itemCount: output.rows.length })
  }

  const receipt: UploadReceipt = {
    uploadedAt: new Date().toISOString(),
    boardId: metadata.boardId,
    mode: metadata.mode || 'create_new',
    datasets: receiptDatasets,
    success: true,
  }

  if (!dryRun) {
    const receiptPath = path.join(DATASETS_DIR, boardDir, 'last-upload.json')
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n')
    console.log(`  Receipt written to ${receiptPath}`)
  }

  return receipt
}

function updateManifest(): void {
  const boardDirs = listBoardDirs()
  const entries: ManifestEntry[] = []

  for (const dir of boardDirs) {
    const metadata = readMetadata(dir)
    const entry: ManifestEntry = {
      boardId: metadata.boardId,
      directory: dir,
      datasetNamePrefix: metadata.datasetNamePrefix,
      description: metadata.description,
      author: metadata.author,
    }

    const receiptPath = path.join(DATASETS_DIR, dir, 'last-upload.json')
    if (fs.existsSync(receiptPath)) {
      try {
        const receipt: UploadReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf-8'))
        entry.lastUpload = {
          uploadedAt: receipt.uploadedAt,
          datasets: receipt.datasets,
        }
      } catch {
        // skip malformed receipt
      }
    }

    entries.push(entry)
  }

  const manifest: Manifest = {
    datasets: entries,
    generatedAt: new Date().toISOString(),
  }

  fs.writeFileSync(path.join(DATASETS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`\nManifest updated with ${entries.length} dataset(s)`)
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const all = args.includes('--all')
  const changed = args.includes('--changed')
  const boardIdx = args.indexOf('--board')
  const boardArg = boardIdx !== -1 ? args[boardIdx + 1] : null

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
      // Strip surrounding quotes
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

  let boardDirs: string[]

  if (boardArg) {
    // Single board
    if (!fs.existsSync(path.join(DATASETS_DIR, boardArg, 'metadata.json'))) {
      console.error(`Error: Board directory not found: datasets/src/${boardArg}/metadata.json`)
      process.exit(1)
    }
    boardDirs = [boardArg]
  } else if (changed) {
    // Detect changed boards from git
    const { execSync } = await import('child_process')
    try {
      const diffOutput = execSync('git diff --name-only HEAD~1 HEAD -- datasets/src/', { encoding: 'utf-8' })
      const changedDirs = new Set<string>()
      for (const file of diffOutput.trim().split('\n')) {
        if (!file) continue
        // Extract board dir: datasets/src/{boardDir}/...
        const parts = file.split('/')
        if (parts.length >= 3 && parts[0] === 'datasets' && parts[1] === 'src') {
          const boardDir = parts[2]
          if (fs.existsSync(path.join(DATASETS_DIR, boardDir, 'metadata.json'))) {
            changedDirs.add(boardDir)
          }
        }
      }
      boardDirs = [...changedDirs]
      if (boardDirs.length === 0) {
        console.log('No changed board directories detected.')
        updateManifest()
        return
      }
      console.log(`Detected ${boardDirs.length} changed board(s): ${boardDirs.join(', ')}`)
    } catch {
      console.error('Warning: Could not detect changed files from git. Processing all boards.')
      boardDirs = listBoardDirs()
    }
  } else if (all) {
    boardDirs = listBoardDirs()
    if (boardDirs.length === 0) {
      console.log('No board directories found in datasets/src/')
      return
    }
    console.log(`Processing all ${boardDirs.length} board(s): ${boardDirs.join(', ')}`)
  } else {
    console.log(`Usage:
  npx tsx scripts/upload-datasets.ts --board <board-dir>
  npx tsx scripts/upload-datasets.ts --all
  npx tsx scripts/upload-datasets.ts --changed

Options:
  --dry-run   Preview conversion without uploading`)
    process.exit(0)
  }

  let hasErrors = false
  for (const dir of boardDirs) {
    try {
      await processBoard(dir, dryRun)
    } catch (err) {
      hasErrors = true
      console.error(`\nERROR processing ${dir}:`, err instanceof Error ? err.message : err)

      // Write error receipt
      if (!dryRun) {
        const receipt: UploadReceipt = {
          uploadedAt: new Date().toISOString(),
          boardId: dir,
          mode: 'unknown',
          datasets: [],
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
        const receiptPath = path.join(DATASETS_DIR, dir, 'last-upload.json')
        fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n')
      }
    }
  }

  updateManifest()

  if (hasErrors) {
    console.error('\nSome boards failed. Check output above.')
    process.exit(1)
  }

  console.log('\nDone.')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
