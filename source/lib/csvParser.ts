/**
 * CSV parser that correctly handles multi-line quoted fields.
 * A quoted field can contain newlines, commas, and escaped quotes ("").
 */

export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = []
  let current = ''
  let inQuotes = false
  let fields: string[] = []

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
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
        fields.push(current)
        current = ''
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        if (ch === '\r') i++
        fields.push(current)
        current = ''
        if (fields.some(f => f !== '')) {
          records.push(fields)
        }
        fields = []
      } else {
        current += ch
      }
    }
  }

  fields.push(current)
  if (fields.some(f => f !== '')) {
    records.push(fields)
  }

  return records
}

export function parseCsvToObjects<T>(text: string): T[] {
  const records = parseCsvRecords(text)
  if (records.length < 2) return []

  const headers = records[0].map(h => h.trim())
  const rows: T[] = []

  for (let i = 1; i < records.length; i++) {
    const values = records[i]
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] || '').trim()
    }
    rows.push(row as unknown as T)
  }

  return rows
}
