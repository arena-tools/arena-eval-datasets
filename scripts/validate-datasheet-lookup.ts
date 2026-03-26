#!/usr/bin/env tsx
/**
 * Validate datasheet lookup dataset CSVs.
 *
 * Checks that:
 * 1. CSV has required columns (mpn, question, answer)
 * 2. CSV can be converted into a Langfuse dataset
 *
 * Usage:
 *   npx tsx scripts/validate-datasheet-lookup.ts          # validate all
 *   npx tsx scripts/validate-datasheet-lookup.ts --changed # only files changed in this PR
 */

import fs from 'fs'
import path from 'path'
import { convertDatasheetLookup } from '../src/converters/datasheetLookupConverters.js'

const DATASETS_DIR = path.resolve(import.meta.dirname || __dirname, '..', 'datasets', 'datasheet_lookup')

function listCsvFiles(): string[] {
  if (!fs.existsSync(DATASETS_DIR)) return []
  return fs.readdirSync(DATASETS_DIR).filter(name => name.endsWith('.csv'))
}

async function main() {
  const args = process.argv.slice(2)
  const changed = args.includes('--changed')

  let csvFiles: string[]

  if (changed) {
    const { execSync } = await import('child_process')
    try {
      const base = (process.env.GITHUB_BASE_REF || 'main').trim()
      const diffOutput = execSync(`git diff --name-only origin/${base}...HEAD -- datasets/datasheet_lookup/`, { encoding: 'utf-8' })
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
        console.log('No changed CSV files to validate.')
        return
      }
    } catch {
      console.log('Could not detect changed files, validating all.')
      csvFiles = listCsvFiles()
    }
  } else {
    csvFiles = listCsvFiles()
  }

  if (csvFiles.length === 0) {
    console.log('No CSV files found to validate.')
    return
  }

  console.log(`Validating ${csvFiles.length} file(s): ${csvFiles.join(', ')}\n`)

  let hasErrors = false
  for (const file of csvFiles) {
    const prefix = file.replace(/\.csv$/, '')
    const datasetName = `DatasheetLookup-${prefix}`
    process.stdout.write(`  ${file}: `)

    const csvPath = path.join(DATASETS_DIR, file)
    try {
      const csvText = fs.readFileSync(csvPath, 'utf-8')
      const output = convertDatasheetLookup(csvText, datasetName)
      console.log(`OK — ${output.rows.length} items -> "${datasetName}"`)
    } catch (err) {
      hasErrors = true
      console.log(`FAIL — ${err instanceof Error ? err.message : err}`)
    }
  }

  if (hasErrors) {
    console.error('\nValidation failed.')
    process.exit(1)
  }

  console.log('\nAll datasets valid.')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
