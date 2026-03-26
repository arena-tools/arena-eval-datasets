#!/usr/bin/env tsx
/**
 * SRC Eval Dataset Upload Script
 *
 * Usage:
 *   npx tsx scripts/upload-datasets.ts --file SRC_global_rules_tida.csv
 *   npx tsx scripts/upload-datasets.ts --all
 *   npx tsx scripts/upload-datasets.ts --changed
 *   npx tsx scripts/upload-datasets.ts --all --dry-run
 */

import fs from 'fs'
import path from 'path'
import { convertAll } from '../source/converters/srcDatasetConverters.js'
import { getLangfuseConfig, createDataset, uploadDatasetItem, clearDatasetItems } from './lib/langfuse.js'
import { listCsvFiles, getChangedCsvFiles } from './lib/git.js'
import { SRC_DIR } from './lib/paths.js'

const DATASETS_DIR = SRC_DIR

async function processFile(csvFilename: string, dryRun: boolean): Promise<void> {
  const prefix = csvFilename.replace(/\.csv$/, '')
  const csvText = fs.readFileSync(path.join(DATASETS_DIR, csvFilename), 'utf-8')

  console.log(`\n--- ${csvFilename} (prefix: ${prefix}) ---`)
  const outputs = convertAll(csvText)

  for (const output of outputs) {
    const datasetName = `${prefix}-${output.name}`
    console.log(`  [${output.name}] ${output.rows.length} items -> "${datasetName}"`)

    if (!dryRun) {
      await createDataset(datasetName)
      const deleted = await clearDatasetItems(datasetName)
      if (deleted > 0) console.log(`    -> cleared ${deleted} existing items`)

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
      console.log(`    -> (dry run)`)
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const all = args.includes('--all')
  const changed = args.includes('--changed')
  const fileIdx = args.indexOf('--file')
  const fileArg = fileIdx !== -1 ? args[fileIdx + 1] : null

  const config = getLangfuseConfig()
  if (!dryRun && (!config.publicKey || !config.secretKey)) {
    console.error('Error: Langfuse credentials not found.')
    process.exit(1)
  }
  if (dryRun) console.log('[DRY RUN]\n')

  let csvFiles: string[]
  if (fileArg) {
    if (!fs.existsSync(path.join(DATASETS_DIR, fileArg))) {
      console.error(`Error: File not found: ${fileArg}`)
      process.exit(1)
    }
    csvFiles = [fileArg]
  } else if (changed) {
    try {
      csvFiles = await getChangedCsvFiles(DATASETS_DIR, 'datasets/schematic_rule_check/')
      if (csvFiles.length === 0) { console.log('No changed CSV files.'); return }
      console.log(`Changed: ${csvFiles.join(', ')}`)
    } catch { csvFiles = listCsvFiles(DATASETS_DIR) }
  } else if (all) {
    csvFiles = listCsvFiles(DATASETS_DIR)
    if (csvFiles.length === 0) { console.log('No CSV files found.'); return }
  } else {
    console.log('Usage: --file <name> | --all | --changed [--dry-run]')
    process.exit(0)
  }

  let hasErrors = false
  for (const f of csvFiles) {
    try { await processFile(f, dryRun) }
    catch (err) { hasErrors = true; console.error(`\nERROR ${f}:`, err instanceof Error ? err.message : err) }
  }
  if (hasErrors) { console.error('\nSome files failed.'); process.exit(1) }
  console.log('\nDone.')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
