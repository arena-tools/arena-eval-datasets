/**
 * Git helpers for detecting changed files.
 */

import fs from 'fs'
import path from 'path'

/**
 * List CSV files in a directory.
 */
export function listCsvFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(name => name.endsWith('.csv'))
}

/**
 * Detect changed CSV files in a directory between HEAD~1 and HEAD.
 * Used by upload scripts (push trigger).
 */
export async function getChangedCsvFiles(dir: string, gitPath: string): Promise<string[]> {
  const { execSync } = await import('child_process')
  const diffOutput = execSync(`git diff --name-only HEAD~1 HEAD -- ${gitPath}`, { encoding: 'utf-8' })
  const changed = new Set<string>()
  for (const file of diffOutput.trim().split('\n')) {
    if (!file) continue
    const basename = path.basename(file)
    if (basename.endsWith('.csv') && fs.existsSync(path.join(dir, basename))) {
      changed.add(basename)
    }
  }
  return [...changed]
}

/**
 * Detect changed CSV files between a base branch and HEAD.
 * Used by validation scripts (PR trigger).
 */
export async function getChangedCsvFilesForPR(dir: string, gitPath: string): Promise<string[]> {
  const { execSync } = await import('child_process')
  const base = (process.env.GITHUB_BASE_REF || 'main').trim()
  const diffOutput = execSync(`git diff --name-only origin/${base}...HEAD -- ${gitPath}`, { encoding: 'utf-8' })
  const changed = new Set<string>()
  for (const file of diffOutput.trim().split('\n')) {
    if (!file) continue
    const basename = path.basename(file)
    if (basename.endsWith('.csv') && fs.existsSync(path.join(dir, basename))) {
      changed.add(basename)
    }
  }
  return [...changed]
}
