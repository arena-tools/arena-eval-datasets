/**
 * Test Planning Dataset Converter
 *
 * Converts a CSV with columns (board_name, goal, procedure, selected_items, expected_output)
 * into Langfuse dataset items where:
 *   input  = { board_name, input_state: { goal?, procedure? }, selected_items }
 *   output = list (parsed from expected_output)
 *
 * The source CSV stores goal and procedure as separate columns for readability.
 * The converter reassembles them into the input_state object expected by Langfuse.
 *
 * Input CSV columns: board_name, goal, procedure, selected_items, expected_output
 */

export interface TestPlanningRow {
  board_name: string
  goal: string
  procedure: string
  selected_items: string
  expected_output: string
}

export interface TestPlanningItem {
  input: { board_name: string; input_state: Record<string, string> | null; selected_items: string[] }
  expectedOutput: unknown[]
}

export interface TestPlanningOutput {
  name: string
  rows: TestPlanningItem[]
}

import { parseCsvToObjects } from '../lib/csvParser.js'

export function parseCsv(text: string): TestPlanningRow[] {
  return parseCsvToObjects<TestPlanningRow>(text)
}

export function convertTestPlanning(csvText: string, datasetName: string): TestPlanningOutput {
  const rows = parseCsv(csvText)
  if (rows.length === 0) throw new Error('No data rows found in CSV')

  const requiredColumns = ['board_name', 'selected_items', 'expected_output']
  const headers = Object.keys(rows[0])
  const missing = requiredColumns.filter(c => !headers.includes(c))
  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(', ')}. Found: ${headers.join(', ')}`)
  }

  return {
    name: datasetName,
    rows: rows.map(row => {
      const state: Record<string, string> = {}
      if (row.goal) state.goal = row.goal
      if (row.procedure) state.procedure = row.procedure
      const inputState = Object.keys(state).length > 0 ? state : null

      let selectedItems: string[]
      try { selectedItems = JSON.parse(row.selected_items) } catch { selectedItems = [row.selected_items] }

      let expectedOutput: unknown[]
      try { expectedOutput = JSON.parse(row.expected_output) } catch { expectedOutput = [row.expected_output] }

      return {
        input: { board_name: row.board_name, input_state: inputState, selected_items: selectedItems },
        expectedOutput,
      }
    }),
  }
}
