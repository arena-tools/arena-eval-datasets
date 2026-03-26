#!/usr/bin/env tsx
/**
 * Aggregate Dataset Upload Script
 *
 * Usage:
 *   npx tsx scripts/upload-aggregates.ts --name my-aggregate
 *   npx tsx scripts/upload-aggregates.ts --all
 *   npx tsx scripts/upload-aggregates.ts --affected
 *   npx tsx scripts/upload-aggregates.ts --all --dry-run
 */

import fs from 'fs'
import path from 'path'
import { convertAll } from '../source/converters/srcDatasetConverters.js'
import { convertDatasheetLookup } from '../source/converters/datasheetLookupConverters.js'
import { getLangfuseConfig, createDataset, uploadDatasetItem, clearDatasetItems } from './lib/langfuse.js'

interface AggregateDefinition {
  name: string
  mode: 'schematic_rule_check' | 'datasheet_lookup'
  sources: string[]
}

const ROOT_DIR = path.resolve(import.meta.dirname || __dirname, '..')
const AGGREGATES_PATH = process.env.AGGREGATES_PATH || path.join(ROOT_DIR, 'datasets', 'aggregates.json')
const SRC_DIR = process.env.SRC_DATASETS_DIR || path.join(ROOT_DIR, 'datasets', 'schematic_rule_check')
const DATASHEET_DIR = process.env.DATASHEET_DATASETS_DIR || path.join(ROOT_DIR, 'datasets', 'datasheet_lookup')

function loadAggregates(): AggregateDefinition[] {
  if (!fs.existsSync(AGGREGATES_PATH)) return []
  return JSON.parse(fs.readFileSync(AGGREGATES_PATH, 'utf-8'))
}

async function processAggregate(agg: AggregateDefinition, dryRun: boolean): Promise<void> {
  const sourceDir = agg.mode === 'schematic_rule_check' ? SRC_DIR : DATASHEET_DIR
  console.log(`\n--- Aggregate: ${agg.name} (${agg.mode}, ${agg.sources.length} sources) ---`)

  if (agg.mode === 'schematic_rule_check') {
    const merged: Record<string, Record<string, string>[]> = {}
    for (const src of agg.sources) {
      const csvText = fs.readFileSync(path.join(sourceDir, src), 'utf-8')
      for (const output of convertAll(csvText)) {
        if (!merged[output.name]) merged[output.name] = []
        merged[output.name].push(...output.rows)
      }
    }
    for (const [type, rows] of Object.entries(merged)) {
      const datasetName = `${agg.name}-${type}`
      console.log(`  [${type}] ${rows.length} items -> "${datasetName}"`)
      if (!dryRun) {
        await createDataset(datasetName)
        const deleted = await clearDatasetItems(datasetName)
        if (deleted > 0) console.log(`    -> cleared ${deleted} existing items`)
        for (const row of rows) {
          const input: Record<string, unknown> = {}
          const expectedOutput = row.expected_output ? JSON.parse(row.expected_output) : {}
          for (const [key, value] of Object.entries(row)) {
            if (key === 'expected_output') continue
            if (value.startsWith('[')) {
              try { input[key] = JSON.parse(value) } catch { input[key] = value }
            } else { input[key] = value }
          }
          await uploadDatasetItem(datasetName, input, expectedOutput)
        }
        console.log(`    -> uploaded ${rows.length} items`)
      } else { console.log(`    -> (dry run)`) }
    }
  } else {
    const datasetName = `DatasheetLookup-${agg.name}`
    const allRows: { input: { mpn: string; question: string }; expectedOutput: string }[] = []
    for (const src of agg.sources) {
      const csvText = fs.readFileSync(path.join(sourceDir, src), 'utf-8')
      allRows.push(...convertDatasheetLookup(csvText, datasetName).rows)
    }
    console.log(`  ${allRows.length} items -> "${datasetName}"`)
    if (!dryRun) {
      await createDataset(datasetName)
      const deleted = await clearDatasetItems(datasetName)
      if (deleted > 0) console.log(`  -> cleared ${deleted} existing items`)
      for (const row of allRows) {
        await uploadDatasetItem(datasetName, row.input as unknown as Record<string, unknown>, row.expectedOutput)
      }
      console.log(`  -> uploaded ${allRows.length} items`)
    } else { console.log(`  -> (dry run)`) }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const all = args.includes('--all')
  const affected = args.includes('--affected')
  const nameIdx = args.indexOf('--name')
  const nameArg = nameIdx !== -1 ? args[nameIdx + 1] : null

  const config = getLangfuseConfig()
  if (!dryRun && (!config.publicKey || !config.secretKey)) {
    console.error('Error: Langfuse credentials not found.')
    process.exit(1)
  }
  if (dryRun) console.log('[DRY RUN]\n')

  const aggregates = loadAggregates()
  if (aggregates.length === 0) { console.log('No aggregates defined.'); return }

  let toProcess: AggregateDefinition[]
  if (nameArg) {
    const found = aggregates.find(a => a.name === nameArg)
    if (!found) { console.error(`Aggregate "${nameArg}" not found`); process.exit(1) }
    toProcess = [found]
  } else if (affected) {
    const { execSync } = await import('child_process')
    try {
      const diffOutput = execSync('git diff --name-only HEAD~1 HEAD -- datasets/', { encoding: 'utf-8' })
      const changedFiles = new Set(diffOutput.trim().split('\n').filter(Boolean).map(f => path.basename(f)))
      const aggChanged = diffOutput.includes('aggregates.json')
      toProcess = aggregates.filter(agg => aggChanged || agg.sources.some(src => changedFiles.has(src)))
      if (toProcess.length === 0) { console.log('No affected aggregates.'); return }
      console.log(`Affected: ${toProcess.map(a => a.name).join(', ')}`)
    } catch { toProcess = aggregates }
  } else if (all) {
    toProcess = aggregates
  } else {
    console.log('Usage: --name <name> | --all | --affected [--dry-run]')
    process.exit(0)
  }

  let hasErrors = false
  for (const agg of toProcess) {
    try { await processAggregate(agg, dryRun) }
    catch (err) { hasErrors = true; console.error(`\nERROR ${agg.name}:`, err instanceof Error ? err.message : err) }
  }
  if (hasErrors) { console.error('\nSome aggregates failed.'); process.exit(1) }
  console.log('\nDone.')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
