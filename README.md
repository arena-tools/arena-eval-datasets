# arena-eval-datasets

Git-driven eval dataset management for Langfuse. Commit CSV files, CI validates them on PR, and GitHub Actions auto-uploads to Langfuse on merge.

> **Full documentation:** [Notion — arena-eval-datasets](https://www.notion.so/32fd2b7c40498166aacdc35ee9e107ac)

## Quick start

```bash
npm install
```

## Repository structure

```
datasets/
  schematic_rule_check/   # SRC eval CSVs (filename must start with SRC_)
  datasheet_lookup/       # Datasheet lookup CSVs
  aggregates.json         # Aggregate dataset definitions
source/
  converters/             # CSV-to-Langfuse conversion logic
  lib/                    # Shared CSV parser
scripts/
  upload-schematic-rule-check.ts
  upload-datasheet-lookup.ts
  upload-aggregates.ts
  validate-schematic-rule-check.ts
  validate-datasheet-lookup.ts
  lib/                    # Shared Langfuse API, env, git helpers
.github/workflows/        # CI validation + upload workflows
```

## Dataset types

### Schematic Rule Check (SRC)

Place CSVs in `datasets/schematic_rule_check/`. Filenames **must** start with `SRC_`.

**Required columns:** `Board Name`, `Tab`, `Rule Number`, `Row Index`, `Requirement`, `Element Type`, `Element ID`, `Result`, `Explainability`

Each CSV creates **4 Langfuse datasets**:
- `{filename}-RULE`
- `{filename}-FANOUT`
- `{filename}-E2E`
- `{filename}-EXPLAINABILITY`

**Example:** `SRC_global_rules_tida.csv` → `SRC_global_rules_tida-RULE`, `SRC_global_rules_tida-FANOUT`, etc.

### Datasheet Lookup

Place CSVs in `datasets/datasheet_lookup/`.

**Required columns:** `mpn`, `question`, `answer`

Each CSV creates **1 Langfuse dataset**: `DatasheetLookup-{filename}`

- Input: `{ "mpn": "...", "question": "..." }`
- Expected output: the answer string

**Example:** `questions_without_charts.csv` → `DatasheetLookup-questions_without_charts`

### Aggregates

Aggregates combine multiple source CSVs into a single Langfuse dataset. Defined in `datasets/aggregates.json`.

**SRC aggregates** merge into 4 datasets: `{name}-RULE`, `-FANOUT`, `-E2E`, `-EXPLAINABILITY`

**Datasheet Lookup aggregates** merge into 1 dataset: `DatasheetLookup-{name}`

When any source CSV changes, affected aggregates are automatically re-uploaded.

#### Creating an aggregate

Edit `datasets/aggregates.json` and add an entry:

```json
[
  {
    "name": "all-questions",
    "mode": "datasheet_lookup",
    "sources": ["chart_questions.csv", "questions_without_charts.csv"]
  },
  {
    "name": "all-boards",
    "mode": "schematic_rule_check",
    "sources": ["SRC_global_rules_tida.csv", "SRC_another_board.csv"]
  }
]
```

Each entry has:
- `name` — the Langfuse dataset name (or prefix for SRC)
- `mode` — `schematic_rule_check` or `datasheet_lookup`
- `sources` — array of CSV filenames from the corresponding `datasets/` folder

Commit and push to `main` — the upload workflow runs automatically.

#### Editing an aggregate

Modify the entry in `datasets/aggregates.json` (change sources, etc.) and push to `main`. The workflow detects the change and re-uploads.

## Workflow

1. **Add or modify a CSV** in the appropriate `datasets/` folder
2. **Open a PR** — CI validates the schema and conversion
3. **Merge to main** — GitHub Actions uploads to Langfuse
4. **On re-upload** — existing items are cleared and replaced (Langfuse auto-versions, preserving past run linkage)

## Triggering uploads manually

Uploads run in GitHub Actions using repository secrets. To trigger manually via the GitHub CLI:

```bash
# SRC datasets
gh workflow run upload-schematic-rule-check.yml -f file=all
gh workflow run upload-schematic-rule-check.yml -f file=SRC_global_rules_tida.csv

# Datasheet lookup datasets
gh workflow run upload-datasheet-lookup.yml -f file=all
gh workflow run upload-datasheet-lookup.yml -f file=questions_without_charts.csv

# Aggregates
gh workflow run upload-aggregates.yml -f name=all
gh workflow run upload-aggregates.yml -f name=all-questions
```

You can also trigger these from the GitHub Actions tab in the browser via "Run workflow".

## Local validation (dry run)

You can validate CSVs locally without Langfuse credentials:

```bash
npm install

# Validate SRC datasets
npx tsx scripts/validate-schematic-rule-check.ts

# Validate datasheet lookup datasets
npx tsx scripts/validate-datasheet-lookup.ts

# Preview what would be uploaded (no credentials needed)
npx tsx scripts/upload-schematic-rule-check.ts --all --dry-run
npx tsx scripts/upload-datasheet-lookup.ts --all --dry-run
npx tsx scripts/upload-aggregates.ts --all --dry-run
```

## GitHub Actions secrets

Langfuse credentials are stored as GitHub repository secrets and injected into workflows automatically. There is no local `.env` file — uploads only run in CI.

Set these in the repo settings:
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL`

## Using as a git submodule

This repo can be used as a submodule in a private repo that has its own datasets and Langfuse instance (e.g., govcloud). All scripts resolve paths from a single `DATASETS_ROOT` env var (defaults to `datasets/` relative to the scripts).

Example private repo structure:

```
my-private-datasets/
  shared/                              # git submodule -> arena-eval-datasets
  datasets/
    schematic_rule_check/SRC_board.csv
    datasheet_lookup/questions.csv
    aggregates.json
  .github/workflows/
    upload.yml
```

Example workflow in the private repo:

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      submodules: true
  - run: npm ci --prefix shared
  - run: npx tsx shared/scripts/upload-schematic-rule-check.ts --all
    env:
      DATASETS_ROOT: ${{ github.workspace }}/datasets
      LANGFUSE_PUBLIC_KEY: ${{ secrets.LANGFUSE_PUBLIC_KEY }}
      LANGFUSE_SECRET_KEY: ${{ secrets.LANGFUSE_SECRET_KEY }}
      LANGFUSE_BASE_URL: ${{ secrets.LANGFUSE_BASE_URL }}
```
