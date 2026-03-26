#!/usr/bin/env tsx
/**
 * Validate datasheet lookup dataset CSVs.
 *
 * Usage:
 *   npx tsx scripts/validate-datasheet-lookup.ts          # validate all
 *   npx tsx scripts/validate-datasheet-lookup.ts --changed # only files changed in this PR
 */

import fs from 'fs'
import path from 'path'
import { convertDatasheetLookup } from '../source/converters/datasheetLookupConverters.js'
import { listCsvFiles, getChangedCsvFilesForPR } from './lib/git.js'
import { DATASHEET_DIR } from './lib/paths.js'

const DATASETS_DIR = DATASHEET_DIR

async function main() {
  const changed = process.argv.includes('--changed')

  let csvFiles: string[]
  if (changed) {
    try {
      csvFiles = await getChangedCsvFilesForPR(DATASETS_DIR, 'datasets/datasheet_lookup/')
      if (csvFiles.length === 0) { console.log('No changed CSV files to validate.'); return }
    } catch { csvFiles = listCsvFiles(DATASETS_DIR) }
  } else {
    csvFiles = listCsvFiles(DATASETS_DIR)
  }

  if (csvFiles.length === 0) { console.log('No CSV files found.'); return }
  console.log(`Validating ${csvFiles.length} file(s): ${csvFiles.join(', ')}\n`)

  let hasErrors = false
  for (const file of csvFiles) {
    const prefix = file.replace(/\.csv$/, '')
    const datasetName = `DatasheetLookup-${prefix}`
    process.stdout.write(`  ${file}: `)
    try {
      const output = convertDatasheetLookup(fs.readFileSync(path.join(DATASETS_DIR, file), 'utf-8'), datasetName)
      console.log(`OK — ${output.rows.length} items -> "${datasetName}"`)
    } catch (err) { hasErrors = true; console.log(`FAIL — ${err instanceof Error ? err.message : err}`) }
  }

  if (hasErrors) { console.error('\nValidation failed.'); process.exit(1) }
  console.log('\nAll datasets valid.')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
