/**
 * Shared dataset path resolution.
 *
 * DATASETS_ROOT env var overrides the default (repo root / datasets/).
 * Used by the submodule pattern where a private repo points scripts
 * at its own datasets folder.
 */

import path from 'path'

const DEFAULT_ROOT = path.resolve(import.meta.dirname || __dirname, '..', '..', 'datasets')
const DATASETS_ROOT = process.env.DATASETS_ROOT || DEFAULT_ROOT

export const SRC_DIR = path.join(DATASETS_ROOT, 'schematic_rule_check')
export const DATASHEET_DIR = path.join(DATASETS_ROOT, 'datasheet_lookup')
export const TEST_PLANNING_DIR = path.join(DATASETS_ROOT, 'test_planning')
export const AGGREGATES_PATH = path.join(DATASETS_ROOT, 'aggregates.json')
