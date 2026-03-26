/**
 * Datasheet Lookup Dataset Converter
 *
 * Converts a CSV with columns (mpn, question, answer) into a Langfuse dataset
 * where input = {mpn, question} and expectedOutput = answer string.
 *
 * Input CSV columns: mpn, question, answer
 */

export interface DatasheetLookupRow {
  mpn: string
  question: string
  answer: string
}

export interface DatasheetLookupOutput {
  name: string
  rows: { input: { mpn: string; question: string }; expectedOutput: string }[]
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

export function parseCsv(text: string): DatasheetLookupRow[] {
  const lines = text.split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0]).map(h => h.trim())
  const rows: DatasheetLookupRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const values = parseCsvLine(line)
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] || '').trim()
    }
    rows.push(row as unknown as DatasheetLookupRow)
  }

  return rows
}

export function convertDatasheetLookup(csvText: string, datasetName: string): DatasheetLookupOutput {
  const rows = parseCsv(csvText)
  if (rows.length === 0) throw new Error('No data rows found in CSV')

  const requiredColumns = ['mpn', 'question', 'answer']
  const headers = Object.keys(rows[0])
  const missing = requiredColumns.filter(c => !headers.includes(c))
  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(', ')}. Found: ${headers.join(', ')}`)
  }

  return {
    name: datasetName,
    rows: rows.map(row => ({
      input: { mpn: row.mpn, question: row.question },
      expectedOutput: row.answer,
    })),
  }
}
