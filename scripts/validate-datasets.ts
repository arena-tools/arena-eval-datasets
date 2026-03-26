#!/usr/bin/env tsx
/**
 * Validate SRC eval dataset CSVs.
 *
 * Runs convertAll() on each board's CSV to verify it has the correct schema
 * and can be converted into all 4 Langfuse datasets.
 *
 * Usage:
 *   npx tsx scripts/validate-datasets.ts          # validate all boards
 *   npx tsx scripts/validate-datasets.ts --changed # only boards changed in this PR
 */

import fs from 'fs'
import path from 'path'
import { convertAll } from '../src/converters/srcDatasetConverters.js'

const DATASETS_DIR = path.resolve(import.meta.dirname || __dirname, '..', 'datasets', 'schematic_rule_check')

function listBoardDirs(): string[] {
  if (!fs.existsSync(DATASETS_DIR)) return []
  return fs.readdirSync(DATASETS_DIR).filter(name => {
    const dir = path.join(DATASETS_DIR, name)
    return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'src-eval.csv'))
  })
}

async function main() {
  const args = process.argv.slice(2)
  const changed = args.includes('--changed')

  let boardDirs: string[]

  if (changed) {
    const { execSync } = await import('child_process')
    try {
      const base = (process.env.GITHUB_BASE_REF || 'main').trim()
      const diffOutput = execSync(`git diff --name-only origin/${base}...HEAD -- datasets/schematic_rule_check/`, { encoding: 'utf-8' })
      const changedDirs = new Set<string>()
      for (const file of diffOutput.trim().split('\n')) {
        if (!file) continue
        const parts = file.split('/')
        if (parts.length >= 3 && parts[0] === 'datasets' && parts[1] === 'schematic_rule_check') {
          const boardDir = parts[2]
          if (fs.existsSync(path.join(DATASETS_DIR, boardDir, 'src-eval.csv'))) {
            changedDirs.add(boardDir)
          }
        }
      }
      boardDirs = [...changedDirs]
      if (boardDirs.length === 0) {
        console.log('No changed datasets to validate.')
        return
      }
    } catch {
      console.log('Could not detect changed files, validating all.')
      boardDirs = listBoardDirs()
    }
  } else {
    boardDirs = listBoardDirs()
  }

  if (boardDirs.length === 0) {
    console.log('No datasets found to validate.')
    return
  }

  console.log(`Validating ${boardDirs.length} dataset(s): ${boardDirs.join(', ')}\n`)

  let hasErrors = false
  for (const dir of boardDirs) {
    const csvPath = path.join(DATASETS_DIR, dir, 'src-eval.csv')
    process.stdout.write(`  ${dir}: `)
    try {
      const csvText = fs.readFileSync(csvPath, 'utf-8')
      const outputs = convertAll(csvText)
      const summary = outputs.map(o => `${o.name}(${o.rows.length})`).join(', ')
      console.log(`OK — ${summary}`)
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
