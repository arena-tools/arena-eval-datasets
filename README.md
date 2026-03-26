# arena-eval-datasets

Git-driven eval dataset management for Langfuse. Commit SRC eval CSVs and they auto-upload to Langfuse via GitHub Actions.

## Quick start

```bash
npm install
cp .env.example .env  # fill in your Langfuse credentials
```

## Adding a dataset

1. Name your CSV file starting with `SRC_` (e.g. `SRC_global_rules_tida.csv`)
2. Place it in `datasets/schematic_rule_check/`
3. Commit and push to `main` — the GitHub Actions workflow auto-uploads to Langfuse

The filename (minus `.csv`) becomes the Langfuse dataset name prefix. For example, `SRC_global_rules_tida.csv` creates:
- `SRC_global_rules_tida-rule`
- `SRC_global_rules_tida-fanout`
- `SRC_global_rules_tida-e2e`
- `SRC_global_rules_tida-explainability`

## Manual upload

```bash
# Single file
npx tsx scripts/upload-datasets.ts --file SRC_global_rules_tida.csv

# All files
npx tsx scripts/upload-datasets.ts --all

# Preview without uploading
npx tsx scripts/upload-datasets.ts --all --dry-run
```

## Required CSV columns

`Board Name`, `Tab`, `Rule Number`, `Row Index`, `Requirement`, `Element Type`, `Element ID`, `Result`, `Explainability`

## CI validation

PRs that add or modify CSV files in `datasets/schematic_rule_check/` are validated:
- Filename must start with `SRC_`
- CSV must have all required columns
- CSV must convert successfully into all 4 dataset formats

## GitHub Actions secrets

Set these in the repo settings:
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL`
