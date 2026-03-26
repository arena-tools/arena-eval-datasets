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

import { parseCsvToObjects } from '../lib/csvParser.js'

export function parseCsv(text: string): DatasheetLookupRow[] {
  return parseCsvToObjects<DatasheetLookupRow>(text)
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
