#!/usr/bin/env tsx
/**
 * Validate test planning dataset CSVs.
 *
 * Usage:
 *   npx tsx scripts/validate-test-planning.ts          # validate all
 *   npx tsx scripts/validate-test-planning.ts --changed # only files changed in this PR
 */

import fs from 'fs'
import path from 'path'
import { convertTestPlanning } from '../source/converters/testPlanningConverters.js'
import { listCsvFiles, getChangedCsvFilesForPR } from './lib/git.js'
import { TEST_PLANNING_DIR } from './lib/paths.js'

const DATASETS_DIR = TEST_PLANNING_DIR

async function main() {
  const changed = process.argv.includes('--changed')

  let csvFiles: string[]
  if (changed) {
    try {
      csvFiles = await getChangedCsvFilesForPR(DATASETS_DIR, 'datasets/test_planning/')
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
    const datasetName = `TestPlanning-${prefix}`
    process.stdout.write(`  ${file}: `)
    try {
      const output = convertTestPlanning(fs.readFileSync(path.join(DATASETS_DIR, file), 'utf-8'), datasetName)
      console.log(`OK — ${output.rows.length} items -> "${datasetName}"`)
    } catch (err) { hasErrors = true; console.log(`FAIL — ${err instanceof Error ? err.message : err}`) }
  }

  if (hasErrors) { console.error('\nValidation failed.'); process.exit(1) }
  console.log('\nAll datasets valid.')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
