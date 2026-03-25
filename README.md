# arena-eval-datasets

Git-driven eval dataset management for Langfuse. Commit SRC eval CSVs and they auto-upload to Langfuse via GitHub Actions.

## Quick start

```bash
npm install
cp .env.example .env  # fill in your Langfuse credentials
```

## Adding a dataset

1. Create a directory under `datasets/schematic_rule_check/{board-id}/`
2. Add two files:
   - `src-eval.csv` — the source SRC evaluation CSV
   - `metadata.json` — board configuration

### metadata.json format

```json
{
  "boardId": "139-4947",
  "datasetNamePrefix": "schematic_rule_checks_139-4947",
  "description": "SRC eval for board 139-4947",
  "author": "your-name",
  "mode": "create_new"
}
```

**mode** options:
- `create_new` — creates new Langfuse datasets with prefixed names
- `add_to_existing` — appends items to existing datasets (requires `existingDatasetNames` map)

3. Commit and push to `main` — the GitHub Actions workflow auto-uploads to Langfuse.

## Manual upload

```bash
# Single board
npm run upload -- --board 139-4947

# All boards
npm run upload:all

# Preview without uploading
npm run upload:dry-run

# Only boards changed in last commit
npm run upload:changed
```

## What gets created

Each SRC eval CSV is converted into 4 Langfuse datasets:

| Dataset | Description |
|---------|-------------|
| `{prefix}-rule` | Full rule compliance with subrule elements |
| `{prefix}-fanout` | Element verification and expansion |
| `{prefix}-e2e` | Simple end-to-end rule evaluation |
| `{prefix}-explainability` | Element-level explainability analysis |

## Required CSV columns

`Tab`, `Rule Number`, `Row Index`, `Requirement`, `Element Type`, `Element ID`, `Result`, `Explainability`

## GitHub Actions secrets

Set these in the repo settings:
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL`
