/**
 * SRC Dataset Converters
 *
 * Port of the Python dataset creation scripts from atlas-core to TypeScript.
 * Converts a single source-of-truth SRC results CSV into four Langfuse eval
 * dataset CSVs: rule, fanout, e2e, and explainability.
 *
 * Input CSV columns: Board Name, Tab, Rule Number, Row Index, Requirement,
 * Element Type, Element ID, Result, Explainability
 */

export interface SrcRow {
  'Board Name': string
  Tab: string
  'Rule Number': string
  'Row Index': string
  Requirement: string
  'Element Type': string
  'Element ID': string
  Result: string
  Explainability: string
}

export interface DatasetOutput {
  name: string
  description: string
  headers: string[]
  rows: Record<string, string>[]
  csvContent: string
}

function mapResultToStatus(result: string): string {
  const r = (result || '').trim().toLowerCase()
  if (r.includes('yes - passed') || r === 'passed') return 'passed'
  if (r.includes('no - failed') || r === 'failed') return 'failed'
  if (r.includes('issue verifying') || r === 'issue_verifying') return 'issue_verifying'
  return 'issue_verifying'
}

function parseRowIndex(rowIndex: string): { parent: number | null; sub: number | null } {
  const s = (rowIndex || '').trim()
  if (!s) return { parent: null, sub: null }
  const match = s.match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) return { parent: null, sub: null }
  return {
    parent: parseInt(match[1], 10),
    sub: match[2] ? parseInt(match[2], 10) : null,
  }
}

function parseRuleNumber(ruleNum: string): { parent: string | null; sub: number | null } {
  const s = (ruleNum || '').trim()
  if (!s) return { parent: null, sub: null }
  const match = s.match(/^(\S+?)(?:\.(\d+))?$/)
  if (!match) return { parent: null, sub: null }
  return {
    parent: match[1],
    sub: match[2] ? parseInt(match[2], 10) : null,
  }
}

function buildElementId(elementType: string, elementId: string): string {
  const elemId = (elementId || '').trim()
  if (!elemId) return ''
  let etype = (elementType || 'Net').trim().toLowerCase()
  if (!['component', 'net', 'pin'].includes(etype)) etype = 'net'
  return `${etype}:${elemId}`
}

function toCsv(headers: string[], rows: Record<string, string>[]): string {
  const escape = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`
    }
    return val
  }
  const lines = [headers.map(escape).join(',')]
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h] || '')).join(','))
  }
  return lines.join('\n')
}

// ---------- E2E Dataset (simple: rule text + overall status) ----------

export function createE2eDataset(rows: SrcRow[]): DatasetOutput {
  const boardId = rows[0]?.['Board Name'] || ''
  const parentRules = new Map<string, { requirement: string; result: string }>()
  const ruleOrder: string[] = []

  for (const row of rows) {
    const { parent, sub } = parseRuleNumber(row['Rule Number'])
    if (parent === null || sub !== null) continue
    const requirement = (row.Requirement || '').trim()
    if (!requirement) continue
    if (!parentRules.has(parent)) ruleOrder.push(parent)
    parentRules.set(parent, { requirement, result: row.Result })
  }

  const headers = ['board_name', 'raw_rule', 'expected_output']
  const outputRows: Record<string, string>[] = []

  for (const ruleNum of ruleOrder) {
    const { requirement, result } = parentRules.get(ruleNum)!
    outputRows.push({
      board_name: boardId,
      raw_rule: requirement,
      expected_output: JSON.stringify({ rule_status: mapResultToStatus(result) }),
    })
  }

  return {
    name: 'E2E',
    description: `E2E eval dataset — ${outputRows.length} rules`,
    headers,
    rows: outputRows,
    csvContent: toCsv(headers, outputRows),
  }
}

// ---------- Fanout Dataset ----------

export function createFanoutDataset(rows: SrcRow[]): DatasetOutput {
  const boardId = rows[0]?.['Board Name'] || ''
  const parentRules = new Map<number, string>()
  const fanoutByParent = new Map<number, string[]>()

  for (const row of rows) {
    const { parent, sub } = parseRowIndex(row['Row Index'])
    if (parent === null) continue
    const requirement = (row.Requirement || '').trim()

    if (sub !== null) {
      const fullId = buildElementId(row['Element Type'], row['Element ID'])
      if (fullId) {
        if (!fanoutByParent.has(parent)) fanoutByParent.set(parent, [])
        fanoutByParent.get(parent)!.push(fullId)
      }
    } else if (requirement) {
      parentRules.set(parent, requirement)
    }
  }

  const headers = ['board_name', 'rule', 'expected_output']
  const outputRows: Record<string, string>[] = []

  for (const parent of [...parentRules.keys()].sort((a, b) => a - b)) {
    const requirement = parentRules.get(parent)!
    const subruleElements = fanoutByParent.get(parent) || []
    if (subruleElements.length === 0) continue
    outputRows.push({
      board_name: boardId,
      rule: requirement,
      expected_output: JSON.stringify({ verifiability: 1, subrule_elements: subruleElements }),
    })
  }

  return {
    name: 'FANOUT',
    description: `Fanout eval dataset — ${outputRows.length} rules`,
    headers,
    rows: outputRows,
    csvContent: toCsv(headers, outputRows),
  }
}

// ---------- Rule Dataset (rule + subrule_elements + per-subrule statuses) ----------

export function createRuleDataset(rows: SrcRow[]): DatasetOutput {
  const boardId = rows[0]?.['Board Name'] || ''
  const parentRules = new Map<number, { requirement: string; status: string }>()
  const fanoutItems = new Map<number, { id: string; status: string }[]>()

  for (const row of rows) {
    const { parent, sub } = parseRowIndex(row['Row Index'])
    if (parent === null) continue
    const requirement = (row.Requirement || '').trim()

    if (sub !== null) {
      const fullId = buildElementId(row['Element Type'], row['Element ID'])
      if (fullId) {
        if (!fanoutItems.has(parent)) fanoutItems.set(parent, [])
        fanoutItems.get(parent)!.push({ id: fullId, status: mapResultToStatus(row.Result) })
      }
    } else if (requirement) {
      parentRules.set(parent, { requirement, status: mapResultToStatus(row.Result) })
    }
  }

  const headers = ['board_name', 'rule', 'subrule_elements', 'expected_output']
  const outputRows: Record<string, string>[] = []

  for (const parent of [...parentRules.keys()].sort((a, b) => a - b)) {
    const { requirement, status } = parentRules.get(parent)!
    const items = fanoutItems.get(parent) || []
    if (items.length === 0) continue
    outputRows.push({
      board_name: boardId,
      rule: requirement,
      subrule_elements: JSON.stringify(items.map(i => i.id)),
      expected_output: JSON.stringify({
        expected_rule_status: status,
        expected_subrule_statuses: items.map(i => i.status),
      }),
    })
  }

  return {
    name: 'RULE',
    description: `Rule eval dataset — ${outputRows.length} rules`,
    headers,
    rows: outputRows,
    csvContent: toCsv(headers, outputRows),
  }
}

// ---------- Explainability Dataset ----------

export function createExplainabilityDataset(rows: SrcRow[]): DatasetOutput {
  const boardId = rows[0]?.['Board Name'] || ''
  const parentRules = new Map<number, string>()
  const parentExplainability = new Map<number, {
    elementType: string; elementId: string; result: string; explainability: string
  }>()
  const subruleRows: {
    parentIdx: number; elementType: string; elementId: string; result: string; explainability: string
  }[] = []
  const parentsWithSubrules = new Set<number>()

  for (const row of rows) {
    const { parent, sub } = parseRowIndex(row['Row Index'])
    if (parent === null) continue
    const requirement = (row.Requirement || '').trim()
    const elementType = (row['Element Type'] || '').trim()
    const elementId = (row['Element ID'] || '').trim()
    const result = (row.Result || '').trim()
    const explainability = (row.Explainability || '').trim()

    if (sub !== null) {
      parentsWithSubrules.add(parent)
      if (explainability) {
        subruleRows.push({ parentIdx: parent, elementType, elementId, result, explainability })
      }
    } else {
      if (requirement) parentRules.set(parent, requirement)
      if (explainability) {
        parentExplainability.set(parent, { elementType, elementId, result, explainability })
      }
    }
  }

  const headers = ['board_name', 'rule', 'element_type', 'element_id', 'expected_output']
  const outputRows: Record<string, string>[] = []

  // Subrule rows
  for (const sr of subruleRows) {
    const requirement = parentRules.get(sr.parentIdx)
    if (!requirement) continue
    const fullElementId = buildElementId(sr.elementType, sr.elementId)
    const normalizedType = (sr.elementType || '').toLowerCase()
    outputRows.push({
      board_name: boardId,
      rule: requirement,
      element_type: normalizedType,
      element_id: fullElementId,
      expected_output: JSON.stringify({
        expected_explainability: sr.explainability,
        expected_status: mapResultToStatus(sr.result),
      }),
    })
  }

  // Non-fanned-out parent rows with explainability
  for (const parentIdx of [...parentExplainability.keys()].sort((a, b) => a - b)) {
    if (parentsWithSubrules.has(parentIdx)) continue
    const requirement = parentRules.get(parentIdx)
    if (!requirement) continue
    const { elementType, elementId, result, explainability } = parentExplainability.get(parentIdx)!
    const fullElementId = buildElementId(elementType, elementId)
    const normalizedType = (elementType || '').toLowerCase()
    outputRows.push({
      board_name: boardId,
      rule: requirement,
      element_type: normalizedType,
      element_id: fullElementId,
      expected_output: JSON.stringify({
        expected_explainability: explainability,
        expected_status: mapResultToStatus(result),
      }),
    })
  }

  return {
    name: 'EXPLAINABILITY',
    description: `Explainability eval dataset — ${outputRows.length} items`,
    headers,
    rows: outputRows,
    csvContent: toCsv(headers, outputRows),
  }
}

// ---------- Parse CSV ----------

export function parseCsv(text: string): SrcRow[] {
  const lines = text.split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0])
  const rows: SrcRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const values = parseCsvLine(line)
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || ''
    }
    rows.push(row as unknown as SrcRow)
  }

  return rows
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        result.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  result.push(current)
  return result
}

// ---------- Convert All ----------

export function convertAll(csvText: string): DatasetOutput[] {
  const rows = parseCsv(csvText)
  if (rows.length === 0) throw new Error('No data rows found in CSV')

  const requiredColumns = ['Board Name', 'Rule Number', 'Row Index', 'Requirement', 'Result']
  const headers = Object.keys(rows[0])
  const missing = requiredColumns.filter(c => !headers.includes(c))
  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(', ')}. Found: ${headers.join(', ')}`)
  }

  return [
    createRuleDataset(rows),
    createFanoutDataset(rows),
    createE2eDataset(rows),
    createExplainabilityDataset(rows),
  ]
}
