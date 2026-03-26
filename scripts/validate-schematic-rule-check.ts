#!/usr/bin/env tsx
/**
 * Validate SRC eval dataset CSVs.
 *
 * Usage:
 *   npx tsx scripts/validate-datasets.ts          # validate all
 *   npx tsx scripts/validate-datasets.ts --changed # only files changed in this PR
 */

import fs from 'fs'
import path from 'path'
import { convertAll } from '../source/converters/srcDatasetConverters.js'
import { listCsvFiles, getChangedCsvFilesForPR } from './lib/git.js'

const DEFAULT_DIR = path.resolve(import.meta.dirname || __dirname, '..', 'datasets', 'schematic_rule_check')
const DATASETS_DIR = process.env.SRC_DATASETS_DIR || DEFAULT_DIR

async function main() {
  const changed = process.argv.includes('--changed')

  let csvFiles: string[]
  if (changed) {
    try {
      csvFiles = await getChangedCsvFilesForPR(DATASETS_DIR, 'datasets/schematic_rule_check/')
      if (csvFiles.length === 0) { console.log('No changed CSV files to validate.'); return }
    } catch { csvFiles = listCsvFiles(DATASETS_DIR) }
  } else {
    csvFiles = listCsvFiles(DATASETS_DIR)
  }

  if (csvFiles.length === 0) { console.log('No CSV files found.'); return }
  console.log(`Validating ${csvFiles.length} file(s): ${csvFiles.join(', ')}\n`)

  let hasErrors = false
  for (const file of csvFiles) {
    process.stdout.write(`  ${file}: `)
    if (!file.startsWith('SRC_')) { hasErrors = true; console.log('FAIL — filename must start with SRC_'); continue }
    try {
      const outputs = convertAll(fs.readFileSync(path.join(DATASETS_DIR, file), 'utf-8'))
      console.log(`OK — ${outputs.map(o => `${o.name}(${o.rows.length})`).join(', ')}`)
    } catch (err) { hasErrors = true; console.log(`FAIL — ${err instanceof Error ? err.message : err}`) }
  }

  if (hasErrors) { console.error('\nValidation failed.'); process.exit(1) }
  console.log('\nAll datasets valid.')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
